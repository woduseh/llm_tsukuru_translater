import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { AlignmentService } from './alignmentService';
import { ApprovalService } from './approvalService';
import { ArtifactService } from './artifactService';
import { BatchPlanningService } from './batchPlanningService';
import { CorpusSamplingService } from './corpusSamplingService';
import { DataRefService } from './dataRefService';
import { AgentEventBus } from './eventBus';
import { GlossaryService } from './glossaryService';
import { JobGraphService } from './jobGraphService';
import { JobService } from './jobService';
import { MemoryService } from './memoryService';
import { PatchService } from './patchService';
import { QaService } from './qaService';
import { RepairLoopService } from './repairLoopService';
import { WorkflowService } from './workflowService';
import { AgentWorkspaceDescriptor, WorkspaceService, type WorkspaceServiceOptions } from './workspaceService';

export interface AgentServiceOptions extends WorkspaceServiceOptions {
  eventHistoryLimit?: number;
  sessionId?: string;
}

export class AgentService {
  readonly workspace: WorkspaceService;
  readonly descriptor: AgentWorkspaceDescriptor;
  readonly eventBus: AgentEventBus;
  readonly artifacts: ArtifactService;
  readonly jobs: JobService;
  readonly jobGraphs: JobGraphService;
  readonly workflows: WorkflowService;
  readonly approvals: ApprovalService;
  readonly files: AgentSafeFileSystem;
  readonly dataRefs: DataRefService;
  readonly batch: BatchPlanningService;
  readonly corpus: CorpusSamplingService;
  readonly alignment: AlignmentService;
  readonly patch: PatchService;
  readonly glossary: GlossaryService;
  readonly memory: MemoryService;
  readonly qa: QaService;
  readonly repair: RepairLoopService;

  constructor(options: AgentServiceOptions) {
    this.workspace = new WorkspaceService(options.projectRoot);
    this.descriptor = this.workspace.ensureWorkspace(options);
    this.eventBus = new AgentEventBus({ workspaceRoot: this.descriptor.workspaceRoot, maxHistory: options.eventHistoryLimit });
    this.artifacts = new ArtifactService({ workspaceRoot: this.descriptor.workspaceRoot, eventBus: this.eventBus });
    this.dataRefs = new DataRefService({ projectRoot: this.descriptor.projectRoot, workspaceRoot: this.descriptor.workspaceRoot });
    this.jobs = new JobService({ workspaceRoot: this.descriptor.workspaceRoot, eventBus: this.eventBus, artifactService: this.artifacts });
    this.jobGraphs = new JobGraphService({
      workspaceRoot: this.descriptor.workspaceRoot,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
      eventBus: this.eventBus,
    });
    this.workflows = new WorkflowService({
      workspaceRoot: this.descriptor.workspaceRoot,
      graphs: this.jobGraphs,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
    });
    this.approvals = new ApprovalService({ eventBus: this.eventBus, sessionId: options.sessionId, auditRoot: this.descriptor.workspaceRoot });
    this.files = new AgentSafeFileSystem({
      projectRoot: this.descriptor.projectRoot,
      allowedRoots: [this.descriptor.projectRoot, this.descriptor.workspaceRoot],
    });
    this.batch = new BatchPlanningService({
      projectRoot: this.descriptor.projectRoot,
      files: this.files,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
    });
    this.corpus = new CorpusSamplingService({
      projectRoot: this.descriptor.projectRoot,
      workspaceRoot: this.descriptor.workspaceRoot,
      files: this.files,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
    });
    this.alignment = new AlignmentService({
      projectRoot: this.descriptor.projectRoot,
      files: this.files,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
    });
    this.patch = new PatchService({
      files: this.files,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
    });
    this.glossary = new GlossaryService({ workspaceRoot: this.descriptor.workspaceRoot });
    this.memory = new MemoryService({ workspaceRoot: this.descriptor.workspaceRoot });
    this.qa = new QaService({
      files: this.files,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
      alignment: this.alignment,
      glossary: this.glossary,
      memory: this.memory,
    });
    this.repair = new RepairLoopService({
      files: this.files,
      artifacts: this.artifacts,
      dataRefs: this.dataRefs,
      jobs: this.jobs,
      qa: this.qa,
      patch: this.patch,
      glossary: this.glossary,
    });
  }

  refreshManifest(): AgentWorkspaceDescriptor {
    return this.workspace.ensureWorkspace({
      currentJobs: this.jobs.listCurrentJobSummaries(),
    });
  }
}

export function createAgentService(options: AgentServiceOptions): AgentService {
  return new AgentService(options);
}
