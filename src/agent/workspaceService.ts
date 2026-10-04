import * as fs from 'fs';
import * as path from 'path';
import type { AgentJobSummary, AgentProjectManifest, FailureArtifact, JsonObject, McpToolDefinition } from '../types/agentWorkspace';
import { AgentWorkspaceStorage } from './agentWorkspaceStorage';
import { redactSecretLikeValues } from './contractsValidation';
import { detectAgentProjectEngine } from './projectEngine';

export { AGENT_WORKSPACE_DIRECTORY } from './agentWorkspaceStorage';
export const AGENT_WORKSPACE_SUBDIRECTORIES = [
  'jobs',
  'artifacts',
  'handoffs',
  'checkpoints',
  'audit',
  'mcp',
  'terminal-sessions',
  'manifests',
  'glossary',
  'memory',
] as const;

export interface WorkspaceServiceOptions {
  projectRoot: string;
  engine?: string;
  providerMetadata?: JsonObject;
  availableTools?: McpToolDefinition[];
  currentJobs?: AgentJobSummary[];
  lastFailures?: FailureArtifact[];
}

export interface AgentWorkspaceDescriptor {
  projectRoot: string;
  workspaceRoot: string;
  manifestPath: string;
  manifestMirrorPath: string;
  manifest: AgentProjectManifest;
}

const DEFAULT_QUALITY_RULES = [
  'Preserve extracted .txt line-number alignment with .extracteddata metadata.',
  'Preserve RPG Maker separators, control codes, and empty lines.',
  'Keep provider secrets out of artifacts, audit logs, MCP responses, and terminal output.',
  'Analysis artifacts may be written under .llm-tsukuru-agent. Game-file patch proposals require a per-request decision in the app approval queue.',
];

export class WorkspaceService {
  readonly projectRoot: string;
  readonly workspaceRoot: string;
  private readonly storage: AgentWorkspaceStorage;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    if (!fs.existsSync(this.projectRoot)) {
      throw new Error(`Agent project root does not exist: ${this.projectRoot}`);
    }
    if (!fs.statSync(this.projectRoot).isDirectory()) {
      throw new Error(`Agent project root is not a directory: ${this.projectRoot}`);
    }
    this.storage = new AgentWorkspaceStorage(this.projectRoot);
    this.workspaceRoot = this.storage.workspaceRoot;
  }

  describeWorkspace(options: Omit<WorkspaceServiceOptions, 'projectRoot'> = {}): AgentWorkspaceDescriptor {
    const manifest = this.createManifest(options);
    return {
      projectRoot: this.projectRoot,
      workspaceRoot: this.workspaceRoot,
      manifestPath: path.join(this.workspaceRoot, 'agent-project.json'),
      manifestMirrorPath: path.join(this.workspaceRoot, 'manifests', 'agent-project.json'),
      manifest,
    };
  }

  ensureWorkspaceDirectories(subdirectories: readonly (typeof AGENT_WORKSPACE_SUBDIRECTORIES)[number][] = []): void {
    this.storage.ensureDirectory('');
    for (const dir of subdirectories) {
      this.storage.ensureDirectory(dir);
    }
  }

  writeManifest(options: Omit<WorkspaceServiceOptions, 'projectRoot'> = {}): AgentWorkspaceDescriptor {
    const descriptor = this.describeWorkspace(options);
    this.ensureWorkspaceDirectories(['manifests']);
    this.storage.writeJson('agent-project.json', descriptor.manifest);
    this.storage.writeJson('manifests/agent-project.json', descriptor.manifest);
    return descriptor;
  }

  ensureWorkspace(options: Omit<WorkspaceServiceOptions, 'projectRoot'> = {}): AgentWorkspaceDescriptor {
    this.ensureWorkspaceDirectories(AGENT_WORKSPACE_SUBDIRECTORIES);
    return this.writeManifest(options);
  }

  createManifest(options: Omit<WorkspaceServiceOptions, 'projectRoot'> = {}): AgentProjectManifest {
    const providerMetadata: JsonObject = options.providerMetadata
      ? { ...redactSecretLikeValues(options.providerMetadata).value, secretsRedacted: true }
      : { status: 'placeholder', activeProvider: null, secretsRedacted: true };
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      engine: {
        name: options.engine ?? detectAgentProjectEngine(this.projectRoot),
        projectPath: this.projectRoot,
      },
      projectPath: this.projectRoot,
      workspacePath: this.workspaceRoot,
      translationInventory: {
        status: 'placeholder',
        sourceFiles: [],
        extractedTextFiles: [],
        notes: ['Inventory will be populated by future extract/translate adapters.'],
      },
      providerMetadata,
      qualityRules: DEFAULT_QUALITY_RULES,
      availableTools: options.availableTools ?? [],
      currentJobs: options.currentJobs ?? [],
      lastFailures: options.lastFailures ?? [],
    };
  }
}
