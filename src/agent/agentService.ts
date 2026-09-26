import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { AlignmentService } from './alignmentService';
import { ArtifactService } from './artifactService';
import { DataRefService } from './dataRefService';
import { AgentEventBus } from './eventBus';
import { GlossaryService } from './glossaryService';
import { JobService } from './jobService';
import { MemoryService } from './memoryService';
import { PatchService } from './patchService';
import { QaService } from './qaService';
import { AgentWorkspaceDescriptor, WorkspaceService, type WorkspaceServiceOptions } from './workspaceService';

export interface AgentServiceOptions extends WorkspaceServiceOptions {
  eventHistoryLimit?: number;
}

export class AgentService {
  readonly workspace: WorkspaceService;
  readonly descriptor: AgentWorkspaceDescriptor;
  readonly eventBus: AgentEventBus;
  readonly artifacts: ArtifactService;
  readonly jobs: JobService;
  readonly files: AgentSafeFileSystem;
  readonly dataRefs: DataRefService;
  readonly alignment: AlignmentService;
  readonly patch: PatchService;
  readonly glossary: GlossaryService;
  readonly memory: MemoryService;
  readonly qa: QaService;
  private readonly manifestOptions: Omit<AgentServiceOptions, 'projectRoot' | 'eventHistoryLimit'>;

  constructor(options: AgentServiceOptions) {
    this.workspace = new WorkspaceService(options.projectRoot);
    this.manifestOptions = {
      engine: options.engine,
      providerMetadata: options.providerMetadata,
      availableTools: options.availableTools,
      currentJobs: options.currentJobs,
      lastFailures: options.lastFailures,
    };
    this.descriptor = this.workspace.describeWorkspace(this.manifestOptions);
    this.eventBus = new AgentEventBus({ workspaceRoot: this.descriptor.workspaceRoot, maxHistory: options.eventHistoryLimit });
    this.artifacts = new ArtifactService({ workspaceRoot: this.descriptor.workspaceRoot, eventBus: this.eventBus });
    this.dataRefs = new DataRefService({ projectRoot: this.descriptor.projectRoot, workspaceRoot: this.descriptor.workspaceRoot });
    this.jobs = new JobService({ workspaceRoot: this.descriptor.workspaceRoot, eventBus: this.eventBus, artifactService: this.artifacts });
    this.files = new AgentSafeFileSystem({
      projectRoot: this.descriptor.projectRoot,
      allowedRoots: [this.descriptor.projectRoot, this.descriptor.workspaceRoot],
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
  }

  refreshManifest(): AgentWorkspaceDescriptor {
    return this.workspace.describeWorkspace({
      ...this.manifestOptions,
      currentJobs: this.jobs.listCurrentJobSummaries(),
    });
  }

  writeManifest(): AgentWorkspaceDescriptor {
    return this.workspace.writeManifest({
      ...this.manifestOptions,
      currentJobs: this.jobs.listCurrentJobSummaries(),
    });
  }
}
