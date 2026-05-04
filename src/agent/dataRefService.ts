import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import type { JsonObject, JsonValue } from '../types/agentWorkspace';
import type { AgentArtifactRecord } from './artifactService';
import { sanitizePathSegment } from './artifactService';
import { redactSecretLikeValues } from './contractsValidation';
import { SandboxPathError, SandboxReadLimitError } from './sandboxManager';

export type AgentDataRefScope = 'session' | 'project';
export type AgentDataRefKind =
  | 'artifact'
  | 'batch-manifest'
  | 'corpus-sample'
  | 'file-slice'
  | 'manifest'
  | 'alignment-map'
  | 'translation-patch'
  | 'patch-preview'
  | 'qa-score'
  | 'job-graph-manifest'
  | 'workflow-dry-run'
  | 'workflow-recipe'
  | 'repair-loop-plan'
  | 'repair-loop-report';

export interface AgentDataRef {
  schemaVersion: 1;
  refId: string;
  scope: AgentDataRefScope;
  kind: AgentDataRefKind;
  projectRoot: string;
  createdAt: string;
  expiresAt?: string;
  target: {
    type: 'artifact-json';
    path: string;
  };
  redaction: {
    redacted: boolean;
    redactions: string[];
  };
  metadata: JsonObject;
}

export interface DataRefReadResult {
  ref: AgentDataRef;
  bytesRead: number;
  truncated: boolean;
  content: JsonValue | string;
  redactions: string[];
}

export interface DataRefServiceOptions {
  projectRoot: string;
  workspaceRoot: string;
  idFactory?: () => string;
}

export class AgentDataRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentDataRefError';
  }
}

export class DataRefService {
  private readonly projectRoot: string;
  private readonly workspaceRoot: string;
  private readonly indexPath: string;
  private readonly idFactory: () => string;

  constructor(options: DataRefServiceOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.indexPath = path.join(this.workspaceRoot, 'mcp', 'data-refs.json');
    this.idFactory = options.idFactory ?? (() => `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  registerArtifactRef(
    artifact: AgentArtifactRecord,
    options: {
      kind?: AgentDataRefKind;
      scope?: AgentDataRefScope;
      ttlMs?: number;
      metadata?: JsonObject;
      now?: Date;
    } = {},
  ): AgentDataRef {
    const now = options.now ?? new Date();
    const ref: AgentDataRef = {
      schemaVersion: 1,
      refId: sanitizePathSegment(this.idFactory()),
      scope: options.scope ?? 'session',
      kind: options.kind ?? 'artifact',
      projectRoot: this.projectRoot,
      createdAt: now.toISOString(),
      expiresAt: typeof options.ttlMs === 'number' ? new Date(now.getTime() + options.ttlMs).toISOString() : undefined,
      target: {
        type: 'artifact-json',
        path: path.resolve(artifact.path),
      },
      redaction: {
        redacted: artifact.redactions.length > 0,
        redactions: [...artifact.redactions],
      },
      metadata: options.metadata ?? {},
    };
    this.writeIndex({ ...this.readIndex(), [ref.refId]: ref });
    return ref;
  }

  readRef(refId: string, options: { maxBytes?: number; projectRoot?: string; now?: Date } = {}): DataRefReadResult {
    const ref = this.readIndex()[sanitizePathSegment(refId)];
    if (!ref) throw new AgentDataRefError(`Unknown data ref: ${refId}`);
    if (options.projectRoot && path.resolve(options.projectRoot) !== ref.projectRoot) {
      throw new AgentDataRefError('Data ref belongs to a different project.');
    }
    if (ref.expiresAt && Date.parse(ref.expiresAt) <= (options.now ?? new Date()).getTime()) {
      throw new AgentDataRefError(`Data ref expired: ${ref.refId}`);
    }
    const targetPath = path.resolve(ref.target.path);
    if (!isPathInsideRoot(targetPath, this.workspaceRoot)) {
      throw new SandboxPathError(`Data ref target escapes workspace: ${ref.refId}`);
    }
    const stat = fs.statSync(targetPath);
    const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 64 * 1024, 256 * 1024));
    const bytesToRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(targetPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const truncated = stat.size > maxBytes;
    const text = buffer.toString('utf-8');
    const parsed = truncated ? text : parseJsonOrText(text);
    const redacted = redactSecretLikeValues(parsed as JsonValue);
    if (bytesToRead === 0 && stat.size > 0) {
      throw new SandboxReadLimitError(`Data ref read exceeds ${maxBytes} bytes: ${ref.refId}`);
    }
    return {
      ref,
      bytesRead: bytesToRead,
      truncated,
      content: redacted.value,
      redactions: Array.from(new Set([...ref.redaction.redactions, ...redacted.redactions])),
    };
  }

  listRefs(): AgentDataRef[] {
    return Object.values(this.readIndex()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private readIndex(): Record<string, AgentDataRef> {
    if (!fs.existsSync(this.indexPath)) return {};
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as Record<string, AgentDataRef>;
  }

  private writeIndex(index: Record<string, AgentDataRef>): void {
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    atomicWriteJsonFile(this.indexPath, index, 2);
  }
}

function parseJsonOrText(text: string): JsonValue | string {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

function isPathInsideRoot(candidatePath: string, root: string): boolean {
  const normalizedCandidate = path.resolve(candidatePath).toLowerCase();
  const normalizedRoot = path.resolve(root).toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}
