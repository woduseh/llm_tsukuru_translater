import * as fs from 'fs';
import * as path from 'path';
import type { AgentJob, AgentJobProgress, AgentJobStatus, AgentJobSummary, FailureArtifact, JsonObject, PermissionTier } from '../types/agentWorkspace';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import { ArtifactService } from './artifactService';
import { AgentEventBus } from './eventBus';
import { sanitizePathSegment } from './artifactService';
import { redactSecretLikeValues } from './contractsValidation';

export interface CreateAgentJobInput {
  kind: string;
  title: string;
  permissionTier?: PermissionTier;
  createdBy?: AgentJob['createdBy'];
  input?: JsonObject;
  jobId?: string;
}

export class AgentJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Agent job not found: ${jobId}`);
    this.name = 'AgentJobNotFoundError';
  }
}

export interface JobServiceOptions {
  workspaceRoot: string;
  eventBus: AgentEventBus;
  artifactService: ArtifactService;
  idFactory?: () => string;
}

export class JobService {
  private readonly jobs = new Map<string, AgentJob>();
  private readonly jobsRoot: string;
  private readonly idFactory: () => string;

  constructor(private readonly options: JobServiceOptions) {
    this.jobsRoot = path.join(options.workspaceRoot, 'jobs');
    this.idFactory = options.idFactory ?? (() => `job-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  createJob(input: CreateAgentJobInput): AgentJob {
    const now = new Date().toISOString();
    const redactedInput = redactSecretLikeValues(input.input ?? {});
    const job: AgentJob = {
      schemaVersion: 1,
      jobId: sanitizePathSegment(input.jobId ?? this.idFactory()),
      kind: input.kind,
      title: input.title,
      status: 'queued',
      permissionTier: input.permissionTier ?? 'readonly',
      createdBy: input.createdBy ?? 'agent',
      createdAt: now,
      updatedAt: now,
      progress: { completed: 0, total: 1, message: 'queued', updatedAt: now },
      input: redactedInput.value,
      artifactPaths: [],
      events: [],
    };
    this.jobs.set(job.jobId, job);
    this.persistJob(job, 'created');
    return job;
  }

  updateStatus(jobId: string, status: AgentJobStatus, message?: string, failure?: FailureArtifact): AgentJob {
    const job = this.requireJob(jobId);
    const now = new Date().toISOString();
    job.status = status;
    job.updatedAt = now;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') job.completedAt = now;
    if (failure) job.failure = failure;
    if (message) job.progress = { ...job.progress, message, updatedAt: now };
    this.persistJob(job, message ?? status);
    return job;
  }

  updateProgress(jobId: string, progress: Partial<Omit<AgentJobProgress, 'updatedAt'>>): AgentJob {
    const job = this.requireJob(jobId);
    const now = new Date().toISOString();
    job.progress = {
      completed: progress.completed ?? job.progress.completed,
      total: progress.total ?? job.progress.total,
      message: progress.message ?? job.progress.message,
      updatedAt: now,
    };
    job.updatedAt = now;
    this.persistJob(job, job.progress.message);
    return job;
  }

  getJob(jobId: string): AgentJob | undefined {
    return this.jobs.get(jobId) ?? this.loadJob(jobId);
  }

  listJobs(): AgentJob[] {
    return Array.from(this.jobs.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listCurrentJobSummaries(): AgentJobSummary[] {
    return this.listJobs()
      .filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status))
      .map((job) => ({
        jobId: job.jobId,
        kind: job.kind,
        title: job.title,
        status: job.status,
        updatedAt: job.updatedAt,
        progress: job.progress,
      }));
  }

  private persistJob(job: AgentJob, message?: string): void {
    const event = this.options.eventBus.emit({
      kind: 'job',
      jobId: job.jobId,
      status: job.status,
      message,
      progress: job.progress as unknown as JsonObject,
    });
    job.events.push(event.eventId);
    const jobPath = path.join(this.jobsRoot, `${job.jobId}.json`);
    atomicWriteJsonFile(jobPath, job, 2);
    const artifact = this.options.artifactService.writeJsonArtifact('job', job.jobId, job as unknown as JsonObject, job.jobId);
    if (!job.artifactPaths.includes(artifact.path)) {
      job.artifactPaths.push(artifact.path);
      atomicWriteJsonFile(jobPath, job, 2);
    }
  }

  private requireJob(jobId: string): AgentJob {
    const job = this.getJob(jobId);
    if (!job) throw new AgentJobNotFoundError(jobId);
    return job;
  }

  private loadJob(jobId: string): AgentJob | undefined {
    const jobPath = path.join(this.jobsRoot, `${sanitizePathSegment(jobId)}.json`);
    if (!fs.existsSync(jobPath)) return undefined;
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8')) as AgentJob;
    this.jobs.set(job.jobId, job);
    return job;
  }
}
