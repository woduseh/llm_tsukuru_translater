import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import type { JsonObject } from '../types/agentWorkspace';
import { redactSecretLikeValues } from './contractsValidation';
import type { AgentProvenance } from './glossaryService';

export type AgentMemoryType =
  | 'style-decision'
  | 'character-voice'
  | 'terminology-decision'
  | 'recurring-correction'
  | 'provider-failure-pattern'
  | 'repair-strategy'
  | 'project-caveat';

export interface AgentMemoryEntry {
  schemaVersion: 1;
  memoryId: string;
  type: AgentMemoryType;
  summary: string;
  details?: string;
  tags: string[];
  confidence: number;
  provenance: AgentProvenance;
  redaction: {
    redacted: boolean;
    redactions: string[];
  };
  createdAt: string;
  updatedAt: string;
  forgottenAt?: string;
}

export interface MemoryWriteInput {
  memoryId?: string;
  type: AgentMemoryType;
  summary: string;
  details?: string;
  tags?: string[];
  confidence?: number;
  provenance: AgentProvenance;
}

export interface MemorySearchOptions {
  query?: string;
  type?: AgentMemoryType;
  tags?: string[];
  includeForgotten?: boolean;
  minConfidence?: number;
  limit?: number;
}

interface MemoryStore {
  schemaVersion: 1;
  entries: AgentMemoryEntry[];
}

export class MemoryService {
  private readonly storePath: string;
  private readonly idFactory: (summary: string) => string;

  constructor(options: { workspaceRoot: string; idFactory?: (summary: string) => string }) {
    this.storePath = path.join(path.resolve(options.workspaceRoot), 'memory', 'entries.json');
    this.idFactory = options.idFactory ?? ((summary) => `mem-${slug(summary)}-${Date.now()}`);
  }

  write(input: MemoryWriteInput, now = new Date()): AgentMemoryEntry {
    requireProvenance(input.provenance);
    const store = this.readStore();
    const memoryId = sanitizeId(input.memoryId ?? this.idFactory(input.summary));
    if (store.entries.some((entry) => entry.memoryId === memoryId)) {
      throw new Error(`Memory already exists: ${memoryId}`);
    }
    const redacted = redactMemoryInput(input);
    const entry: AgentMemoryEntry = {
      schemaVersion: 1,
      memoryId,
      type: redacted.value.type,
      summary: redacted.value.summary,
      details: emptyToUndefined(redacted.value.details),
      tags: uniqueStrings(redacted.value.tags ?? []),
      confidence: clampConfidence(redacted.value.confidence ?? 0.5),
      provenance: redacted.value.provenance,
      redaction: {
        redacted: redacted.redactions.length > 0,
        redactions: redacted.redactions,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    store.entries.push(entry);
    this.writeStore(store);
    return entry;
  }

  search(options: MemorySearchOptions = {}): AgentMemoryEntry[] {
    const query = normalize(options.query ?? '');
    const tags = (options.tags ?? []).map(normalize);
    const limit = positiveInt(options.limit, 20);
    return this.readStore().entries
      .filter((entry) => options.includeForgotten || !entry.forgottenAt)
      .filter((entry) => !query || searchableMemoryText(entry).includes(query))
      .filter((entry) => !options.type || entry.type === options.type)
      .filter((entry) => tags.every((tag) => entry.tags.map(normalize).includes(tag)))
      .filter((entry) => entry.confidence >= (options.minConfidence ?? 0))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  update(memoryId: string, patch: Partial<Omit<MemoryWriteInput, 'memoryId' | 'provenance'>> & { provenance: AgentProvenance }, now = new Date()): AgentMemoryEntry {
    requireProvenance(patch.provenance);
    const store = this.readStore();
    const index = store.entries.findIndex((entry) => entry.memoryId === memoryId);
    if (index < 0) throw new Error(`Unknown memory: ${memoryId}`);
    const current = store.entries[index];
    const redacted = redactMemoryInput({
      type: patch.type ?? current.type,
      summary: patch.summary ?? current.summary,
      details: patch.details ?? current.details,
      tags: patch.tags ?? current.tags,
      confidence: patch.confidence ?? current.confidence,
      provenance: patch.provenance,
    });
    const updated: AgentMemoryEntry = {
      ...current,
      type: redacted.value.type,
      summary: redacted.value.summary,
      details: emptyToUndefined(redacted.value.details),
      tags: uniqueStrings(redacted.value.tags ?? []),
      confidence: clampConfidence(redacted.value.confidence ?? current.confidence),
      provenance: redacted.value.provenance,
      redaction: {
        redacted: current.redaction.redacted || redacted.redactions.length > 0,
        redactions: Array.from(new Set([...current.redaction.redactions, ...redacted.redactions])),
      },
      updatedAt: now.toISOString(),
    };
    store.entries[index] = updated;
    this.writeStore(store);
    return updated;
  }

  forget(memoryId: string, provenance: AgentProvenance, now = new Date()): AgentMemoryEntry {
    requireProvenance(provenance);
    const store = this.readStore();
    const index = store.entries.findIndex((entry) => entry.memoryId === memoryId);
    if (index < 0) throw new Error(`Unknown memory: ${memoryId}`);
    const redacted = redactSecretLikeValues(provenance as unknown as JsonObject) as unknown as { value: AgentProvenance; redactions: string[] };
    const forgotten: AgentMemoryEntry = {
      ...store.entries[index],
      provenance: redacted.value,
      redaction: {
        redacted: store.entries[index].redaction.redacted || redacted.redactions.length > 0,
        redactions: Array.from(new Set([...store.entries[index].redaction.redactions, ...redacted.redactions])),
      },
      updatedAt: now.toISOString(),
      forgottenAt: now.toISOString(),
    };
    store.entries[index] = forgotten;
    this.writeStore(store);
    return forgotten;
  }

  summarize(options: MemorySearchOptions = {}): JsonObject {
    const entries = this.search({ ...options, limit: options.limit ?? 50 });
    const byType: JsonObject = {};
    for (const entry of entries) {
      byType[entry.type] = typeof byType[entry.type] === 'number' ? (byType[entry.type] as number) + 1 : 1;
    }
    return {
      total: entries.length,
      byType,
      topMemories: entries.slice(0, 10).map((entry) => ({
        memoryId: entry.memoryId,
        type: entry.type,
        summary: entry.summary,
        confidence: entry.confidence,
        tags: entry.tags,
      })),
    };
  }

  private readStore(): MemoryStore {
    if (!fs.existsSync(this.storePath)) return { schemaVersion: 1, entries: [] };
    return JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as MemoryStore;
  }

  private writeStore(store: MemoryStore): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    atomicWriteJsonFile(this.storePath, store, 2);
  }
}

function redactMemoryInput(input: MemoryWriteInput): { value: MemoryWriteInput; redactions: string[] } {
  const bounded: MemoryWriteInput = {
    ...input,
    summary: boundText(input.summary, 240),
    details: input.details ? boundText(input.details, 1000) : undefined,
    tags: (input.tags ?? []).map((tag) => boundText(tag, 60)),
  };
  return redactSecretLikeValues(bounded as unknown as JsonObject) as unknown as { value: MemoryWriteInput; redactions: string[] };
}

function requireProvenance(provenance: AgentProvenance | undefined): void {
  if (!provenance || !provenance.source || !provenance.createdBy || !provenance.sourceRefs?.length) {
    throw new Error('Memory entries require provenance with source, createdBy, and at least one sourceRef.');
  }
}

function searchableMemoryText(entry: AgentMemoryEntry): string {
  return normalize([entry.type, entry.summary, entry.details, ...entry.tags, entry.provenance.source, entry.provenance.note].filter(Boolean).join('\n'));
}

function boundText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

function slug(value: string): string {
  return sanitizeId(normalize(value).replace(/\s+/g, '-')) || 'entry';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}
