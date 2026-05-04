import * as path from 'path';
import type { JsonValue } from '../types/agentWorkspace';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import { redactSecretLikeValues } from './contractsValidation';
import { AgentEventBus } from './eventBus';

export interface AgentArtifactRecord {
  schemaVersion: 1;
  artifactId: string;
  kind: string;
  jobId?: string;
  createdAt: string;
  path: string;
  redactions: string[];
  payload: JsonValue;
}

export interface ArtifactServiceOptions {
  workspaceRoot: string;
  eventBus?: AgentEventBus;
}

export class ArtifactService {
  readonly workspaceRoot: string;
  readonly artifactsRoot: string;

  constructor(private readonly options: ArtifactServiceOptions) {
    this.workspaceRoot = options.workspaceRoot;
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
    atomicWriteJsonFile(artifactPath, record, 2);
    this.options.eventBus?.emit({ kind: 'artifact', artifactPath, artifactKind: safeKind, jobId });
    return record;
  }
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'artifact';
}
