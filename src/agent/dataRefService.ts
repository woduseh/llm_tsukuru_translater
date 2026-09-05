import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import type { JsonObject, JsonValue } from '../types/agentWorkspace';
import type { AgentArtifactRecord } from './artifactService';
import { sanitizePathSegment } from './artifactService';
import { redactSecretLikeValues } from './contractsValidation';
import { SandboxPathError, SandboxReadLimitError } from './agentFileErrors';
import { AgentSafeFileSystem } from './agentSafeFileSystem';

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

  /** Whole JSON is bounded on disk; only a small valid JSON page crosses MCP. */
  readPage(refId: string, options: { collection?: string; offset?: number; limit?: number } = {}): JsonObject {
    const ref = this.readIndex()[sanitizePathSegment(refId)];
    if (!ref || ref.refId !== refId || ref.projectRoot !== this.projectRoot) throw new AgentDataRefError(`Unknown data ref: ${refId}`);
    if (ref.expiresAt && Date.parse(ref.expiresAt) <= Date.now()) throw new AgentDataRefError(`Data ref expired: ${refId}`);
    const target = new AgentSafeFileSystem({ projectRoot: this.workspaceRoot }).resolveAllowed(ref.target.path);
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new SandboxReadLimitError('Artifact exceeds the 16 MiB JSON read limit. Inspect a smaller file or lower maxBytes.');
    const record = JSON.parse(fs.readFileSync(target, 'utf8')) as AgentArtifactRecord;
    if (record.schemaVersion !== 1 || record.kind !== ref.kind || !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
      throw new AgentDataRefError('Artifact is not a supported JSON analysis record.');
    }
    const content = record.payload as JsonObject;
    const collection = options.collection ?? 'summary';
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    if (!['summary', 'refs', 'breaks', 'findings', 'operations'].includes(collection)
      || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new AgentDataRefError('Invalid artifact page arguments.');
    }
    let page: JsonObject;
    if (collection === 'summary') {
      const summarize = (value: JsonValue): JsonValue => {
        if (Array.isArray(value)) return { itemCount: value.length };
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, summarize(item)]));
        return value;
      };
      page = { refId, kind: ref.kind, summary: summarize(content) };
    } else {
      const parent = collection === 'operations' && content.patch && typeof content.patch === 'object' ? content.patch as JsonObject : content;
      const rows = parent[collection];
      if (!Array.isArray(rows)) throw new AgentDataRefError(`Artifact has no ${collection} collection.`);
      const items: JsonValue[] = [];
      for (const item of rows.slice(offset, offset + limit)) {
        if (Buffer.byteLength(JSON.stringify([...items, item]), 'utf8') > 48 * 1024) break;
        items.push(item);
      }
      if (!items.length && offset < rows.length) throw new SandboxReadLimitError('One artifact item exceeds the page byte budget. Use translation.read_window for line context.');
      page = { refId, kind: ref.kind, collection, offset, total: rows.length, items,
        nextOffset: offset + items.length < rows.length ? offset + items.length : null };
    }
    const redacted = redactSecretLikeValues(page);
    if (Buffer.byteLength(JSON.stringify(redacted.value), 'utf8') > 64 * 1024) throw new SandboxReadLimitError('Artifact summary exceeds the response limit; request a collection page.');
    return { ...redacted.value, redactions: [...ref.redaction.redactions, ...redacted.redactions] };
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
