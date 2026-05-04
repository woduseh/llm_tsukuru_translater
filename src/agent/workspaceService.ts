import * as fs from 'fs';
import * as path from 'path';
import type { AgentJobSummary, AgentProjectManifest, FailureArtifact, JsonObject, McpToolDefinition } from '../types/agentWorkspace';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import { redactSecretLikeValues } from './contractsValidation';

export const AGENT_WORKSPACE_DIRECTORY = '.llm-tsukuru-agent';
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
  'Use preview artifacts and approval before destructive or project-writing actions.',
];

export class WorkspaceService {
  readonly projectRoot: string;
  readonly workspaceRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.workspaceRoot = path.join(this.projectRoot, AGENT_WORKSPACE_DIRECTORY);
  }

  ensureWorkspace(options: Omit<WorkspaceServiceOptions, 'projectRoot'> = {}): AgentWorkspaceDescriptor {
    fs.mkdirSync(this.projectRoot, { recursive: true });
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    for (const dir of AGENT_WORKSPACE_SUBDIRECTORIES) {
      fs.mkdirSync(path.join(this.workspaceRoot, dir), { recursive: true });
    }
    const manifest = this.createManifest(options);
    const manifestPath = path.join(this.workspaceRoot, 'agent-project.json');
    const manifestMirrorPath = path.join(this.workspaceRoot, 'manifests', 'agent-project.json');
    atomicWriteJsonFile(manifestPath, manifest, 2);
    atomicWriteJsonFile(manifestMirrorPath, manifest, 2);
    return {
      projectRoot: this.projectRoot,
      workspaceRoot: this.workspaceRoot,
      manifestPath,
      manifestMirrorPath,
      manifest,
    };
  }

  createManifest(options: Omit<WorkspaceServiceOptions, 'projectRoot'> = {}): AgentProjectManifest {
    const providerMetadata: JsonObject = options.providerMetadata
      ? { ...redactSecretLikeValues(options.providerMetadata).value, secretsRedacted: true }
      : { status: 'placeholder', activeProvider: null, secretsRedacted: true };
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      engine: {
        name: options.engine ?? 'unknown',
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
