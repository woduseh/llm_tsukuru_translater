import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentSafeFileSystem, AgentService, SandboxPathError, WorkspaceService, AGENT_WORKSPACE_SUBDIRECTORIES } from '../../src/agent';
import { AgentEventBus } from '../../src/agent/eventBus';
import { ArtifactService } from '../../src/agent/artifactService';
import { JobService } from '../../src/agent/jobService';

const sandboxRoot = path.resolve('artifacts', 'unit', 'agentServiceCore');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('agent workspace service scaffold', () => {
  it('creates the bounded .llm-tsukuru-agent layout and manifest', () => {
    const projectRoot = makeDir('workspace');
    const descriptor = new WorkspaceService(projectRoot).ensureWorkspace({ engine: 'rpg-maker-mv' });

    expect(path.basename(descriptor.workspaceRoot)).toBe('.llm-tsukuru-agent');
    for (const dir of AGENT_WORKSPACE_SUBDIRECTORIES) {
      expect(fs.statSync(path.join(descriptor.workspaceRoot, dir)).isDirectory()).toBe(true);
    }
    expect(fs.existsSync(descriptor.manifestPath)).toBe(true);
    expect(fs.existsSync(descriptor.manifestMirrorPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(descriptor.manifestPath, 'utf-8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.engine).toEqual({ name: 'rpg-maker-mv', projectPath: path.resolve(projectRoot) });
    expect(manifest.translationInventory.status).toBe('placeholder');
    expect(manifest.providerMetadata.secretsRedacted).toBe(true);
    expect(manifest.qualityRules.join('\n')).toContain('line-number alignment');
    expect(manifest.currentJobs).toEqual([]);
    expect(manifest.lastFailures).toEqual([]);
  });
});

describe('agent job lifecycle and events', () => {
  it('creates durable jobs, updates progress/status, emits bounded events, and writes artifacts', () => {
    const projectRoot = makeDir('jobs');
    const workspace = new WorkspaceService(projectRoot).ensureWorkspace();
    const bus = new AgentEventBus({ workspaceRoot: workspace.workspaceRoot, maxHistory: 3 });
    const observed: string[] = [];
    const unsubscribe = bus.subscribe((event) => observed.push(`${event.kind}:${event.eventId}`));
    const artifacts = new ArtifactService({ workspaceRoot: workspace.workspaceRoot, eventBus: bus });
    const jobs = new JobService({ workspaceRoot: workspace.workspaceRoot, eventBus: bus, artifactService: artifacts, idFactory: () => 'job-fixture' });

    const job = jobs.createJob({ kind: 'quality.review', title: 'Review batch', input: { apiKey: 'secret-value' } });
    jobs.updateStatus(job.jobId, 'running', 'started');
    jobs.updateProgress(job.jobId, { completed: 1, total: 2, message: 'half done' });
    const completed = jobs.updateStatus(job.jobId, 'completed', 'done');
    unsubscribe();

    expect(completed.status).toBe('completed');
    expect(observed.length).toBeGreaterThanOrEqual(4);
    expect(bus.getHistory()).toHaveLength(3);
    const jobPath = path.join(workspace.workspaceRoot, 'jobs', 'job-fixture.json');
    const artifactPath = path.join(workspace.workspaceRoot, 'artifacts', 'job-job-fixture.json');
    expect(fs.existsSync(jobPath)).toBe(true);
    expect(fs.existsSync(artifactPath)).toBe(true);
    expect(fs.readFileSync(artifactPath, 'utf-8')).not.toContain('secret-value');
  });

  it('aggregates services and refreshes manifest with current jobs', () => {
    const projectRoot = makeDir('aggregate');
    const service = new AgentService({ projectRoot, engine: 'wolf-rpg' });
    const job = service.jobs.createJob({ kind: 'translate.preview', title: 'Preview translation' });
    const refreshed = service.refreshManifest();

    expect(refreshed.manifest.currentJobs.map((entry) => entry.jobId)).toContain(job.jobId);
  });
});

describe('agent safe filesystem', () => {
  it('reads bounded line ranges and redacts secret-like content', () => {
    const projectRoot = makeDir('files');
    fs.mkdirSync(path.join(projectRoot, 'Extract'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'Extract', 'Map001.txt'), '\uFEFFline 1\napi_key=super-secret-value\nline 3\nline 4', 'utf-8');
    const safeFs = new AgentSafeFileSystem({ projectRoot, maxReadBytes: 1024 });

    const result = safeFs.readText('Extract\\Map001.txt', { startLine: 2, endLine: 3, maxBytes: 100 });

    expect(result.text).toContain('[REDACTED]');
    expect(result.text).toContain('line 3');
    expect(result.text).not.toContain('line 1');
    expect(result.redactions.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('rejects path traversal outside allowed roots', () => {
    const projectRoot = makeDir('reject');
    const outside = makeDir('outside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'do not read', 'utf-8');
    const safeFs = new AgentSafeFileSystem({ projectRoot });

    expect(() => safeFs.readText(path.join('..', path.basename(outside), 'secret.txt'))).toThrow(SandboxPathError);
    expect(() => safeFs.resolveAllowed('Extract\\Map001.txt:Zone.Identifier')).toThrow(SandboxPathError);
  });
});

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
