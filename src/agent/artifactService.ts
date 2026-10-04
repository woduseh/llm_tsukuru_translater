import * as path from 'path';
import { AgentWorkspaceStorage } from './agentWorkspaceStorage';
import type { JsonValue } from '../types/agentWorkspace';
import { writeArtifactRecord, type ArtifactStorage } from './artifactPaging';
import { redactSecretLikeValues } from './contractsValidation';

export interface AgentArtifactRecord {
  schemaVersion: 1;
  artifactId: string;
  kind: string;
  jobId?: string;
  createdAt: string;
  path: string;
  redactions: string[];
  payload: JsonValue;
  storage?: ArtifactStorage;
}

export interface ArtifactServiceOptions {
  workspaceRoot: string;
  projectRoot: string;
}

export class ArtifactService {
  readonly workspaceRoot: string;
  readonly artifactsRoot: string;
  private readonly storage: AgentWorkspaceStorage;

  constructor(options: ArtifactServiceOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.storage = new AgentWorkspaceStorage(options.projectRoot, options.workspaceRoot);
    this.artifactsRoot = path.join(this.workspaceRoot, 'artifacts');
  }

  writeJsonArtifact(kind: string, artifactId: string, payload: JsonValue, jobId?: string): AgentArtifactRecord {
    const redacted = redactSecretLikeValues(payload);
    const safeKind = sanitizePathSegment(kind);
    const safeId = sanitizePathSegment(artifactId);
    const artifactPath = path.join(this.artifactsRoot, `${safeKind}-${safeId}.json`);
    const record: AgentArtifactRecord = {
      schemaVersion: 1,
      artifactId: safeId,
      kind: safeKind,
      jobId,
      createdAt: new Date().toISOString(),
      path: artifactPath,
      redactions: redacted.redactions,
      payload: redacted.value,
    };
    this.storage.ensureDirectory('artifacts');
    this.storage.resolve(artifactPath);
    writeArtifactRecord(record, this.storage);
    return record;
  }
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'artifact';
}
