import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import type { JsonObject } from '../types/agentWorkspace';
import { redactSecretLikeValues } from './contractsValidation';
import type { CorpusSampleResult } from './corpusSamplingService';

export interface AgentProvenance {
  source: string;
  createdBy: 'user' | 'agent' | 'mcp' | 'system';
  sourceRefs: GlossarySourceRef[];
  note?: string;
}

export interface GlossarySourceRef {
  kind: 'profile' | 'corpus-sample' | 'file' | 'manual' | 'memory' | 'test';
  path?: string;
  lineNumber?: number;
  refId?: string;
  note?: string;
}

export interface GlossaryExample {
  source: string;
  translation?: string;
  ref?: GlossarySourceRef;
}

export interface GlossaryEntry {
  schemaVersion: 1;
  termId: string;
  sourceText: string;
  preferredTranslation: string;
  forbiddenTranslations: string[];
  aliases: string[];
  speaker?: string;
  context?: string;
  engineType?: string;
  confidence: number;
  examples: GlossaryExample[];
  sourceRefs: GlossarySourceRef[];
  provenance: AgentProvenance;
  redaction: {
    redacted: boolean;
    redactions: string[];
  };
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
}

export interface GlossaryCreateInput {
  termId?: string;
  sourceText: string;
  preferredTranslation: string;
  forbiddenTranslations?: string[];
  aliases?: string[];
  speaker?: string;
  context?: string;
  engineType?: string;
  confidence?: number;
  examples?: GlossaryExample[];
  sourceRefs?: GlossarySourceRef[];
  provenance: AgentProvenance;
  lastValidatedAt?: string;
}

export interface GlossaryConflict {
  kind: 'source-preferred-mismatch' | 'alias-overlap' | 'forbidden-preferred-overlap';
  existingTermId?: string;
  message: string;
}

export interface GlossarySearchOptions {
  query?: string;
  engineType?: string;
  speaker?: string;
  minConfidence?: number;
  limit?: number;
}

export interface GlossaryUsageValidationResult {
  checkedAt: string;
  findings: JsonObject[];
  matchedEntries: GlossaryEntry[];
}

interface GlossaryStore {
  schemaVersion: 1;
  entries: GlossaryEntry[];
}

export class GlossaryService {
  private readonly storePath: string;
  private readonly idFactory: (sourceText: string) => string;

  constructor(options: { workspaceRoot: string; idFactory?: (sourceText: string) => string }) {
    this.storePath = path.join(path.resolve(options.workspaceRoot), 'glossary', 'entries.json');
    this.idFactory = options.idFactory ?? ((sourceText) => `term-${slug(sourceText)}-${Date.now()}`);
  }

  createEntry(input: GlossaryCreateInput, now = new Date()): { entry: GlossaryEntry; conflicts: GlossaryConflict[] } {
    requireProvenance(input.provenance);
    const store = this.readStore();
    const termId = sanitizeId(input.termId ?? this.idFactory(input.sourceText));
    if (store.entries.some((entry) => entry.termId === termId)) {
      throw new Error(`Glossary term already exists: ${termId}`);
    }
    const redactedInput = redactGlossaryInput(input);
    const entry: GlossaryEntry = {
      schemaVersion: 1,
      termId,
      sourceText: redactedInput.value.sourceText,
      preferredTranslation: redactedInput.value.preferredTranslation,
      forbiddenTranslations: uniqueStrings(redactedInput.value.forbiddenTranslations ?? []),
      aliases: uniqueStrings(redactedInput.value.aliases ?? []),
      speaker: emptyToUndefined(redactedInput.value.speaker),
      context: emptyToUndefined(redactedInput.value.context),
      engineType: emptyToUndefined(redactedInput.value.engineType),
      confidence: clampConfidence(redactedInput.value.confidence ?? 0.5),
      examples: (redactedInput.value.examples ?? []).slice(0, 8),
      sourceRefs: redactedInput.value.sourceRefs ?? input.provenance.sourceRefs,
      provenance: redactedInput.value.provenance,
      redaction: {
        redacted: redactedInput.redactions.length > 0,
        redactions: redactedInput.redactions,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastValidatedAt: input.lastValidatedAt,
    };
    const conflicts = detectGlossaryConflicts(entry, store.entries);
    store.entries.push(entry);
    this.writeStore(store);
    return { entry, conflicts };
  }

  search(options: GlossarySearchOptions = {}): GlossaryEntry[] {
    const query = normalize(options.query ?? '');
    const limit = positiveInt(options.limit, 20);
    return this.readStore().entries
      .filter((entry) => !query || searchableGlossaryText(entry).includes(query))
      .filter((entry) => !options.engineType || entry.engineType === options.engineType)
      .filter((entry) => !options.speaker || entry.speaker === options.speaker)
      .filter((entry) => entry.confidence >= (options.minConfidence ?? 0))
      .sort((left, right) => right.confidence - left.confidence || left.sourceText.localeCompare(right.sourceText, 'en'))
      .slice(0, limit);
  }

  proposeEntriesFromCorpus(sample: CorpusSampleResult, options: { limit?: number; confidence?: number } = {}): GlossaryCreateInput[] {
    const limit = positiveInt(options.limit, 10);
    const seen = new Set<string>();
    const proposals: GlossaryCreateInput[] = [];
    for (const item of sample.samples) {
      const text = typeof item.text === 'string' ? item.text : '';
      for (const candidate of extractTermCandidates(text)) {
        const key = normalize(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        proposals.push({
          sourceText: candidate,
          preferredTranslation: '',
          confidence: options.confidence ?? 0.25,
          sourceRefs: [{
            kind: 'corpus-sample',
            path: typeof item.path === 'string' ? item.path : undefined,
            lineNumber: typeof item.lineNumber === 'number' ? item.lineNumber : undefined,
          }],
          provenance: {
            source: 'corpus.sample',
            createdBy: 'agent',
            sourceRefs: [{
              kind: 'corpus-sample',
              path: typeof item.path === 'string' ? item.path : undefined,
              lineNumber: typeof item.lineNumber === 'number' ? item.lineNumber : undefined,
            }],
          },
        });
        if (proposals.length >= limit) return proposals;
      }
    }
    return proposals;
  }

  validateUsage(text: string, options: { now?: Date } = {}): GlossaryUsageValidationResult {
    const checkedAt = (options.now ?? new Date()).toISOString();
    const redactedText = redactSecretLikeValues({ text });
    const haystack = String(redactedText.value.text ?? '');
    const findings: JsonObject[] = [];
    const matchedEntries: GlossaryEntry[] = [];
    for (const entry of this.readStore().entries) {
      const sourcePresent = includesAny(haystack, [entry.sourceText, ...entry.aliases]);
      const preferredPresent = entry.preferredTranslation ? haystack.includes(entry.preferredTranslation) : false;
      const forbiddenHits = entry.forbiddenTranslations.filter((term) => term && haystack.includes(term));
      if (sourcePresent || preferredPresent || forbiddenHits.length > 0) {
        matchedEntries.push(entry);
      }
      for (const forbidden of forbiddenHits) {
        findings.push({ severity: 'error', code: 'forbidden-translation-used', termId: entry.termId, forbidden });
      }
      if (sourcePresent && entry.preferredTranslation && !preferredPresent) {
        findings.push({ severity: 'warning', code: 'preferred-translation-missing', termId: entry.termId, preferredTranslation: entry.preferredTranslation });
      }
    }
    return { checkedAt, findings, matchedEntries };
  }

  private readStore(): GlossaryStore {
    if (!fs.existsSync(this.storePath)) return { schemaVersion: 1, entries: [] };
    return JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as GlossaryStore;
  }

  private writeStore(store: GlossaryStore): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    atomicWriteJsonFile(this.storePath, store, 2);
  }
}

function redactGlossaryInput(input: GlossaryCreateInput): { value: GlossaryCreateInput; redactions: string[] } {
  const redactions: string[] = [];
  const redactedProvenance = redactSecretLikeValues(input.provenance as unknown as JsonObject) as unknown as { value: AgentProvenance; redactions: string[] };
  redactions.push(...redactedProvenance.redactions);
  return {
    value: {
      ...input,
      sourceText: redactText(boundText(input.sourceText), redactions),
      preferredTranslation: redactText(boundText(input.preferredTranslation), redactions),
      forbiddenTranslations: (input.forbiddenTranslations ?? []).map((value) => redactText(boundText(value), redactions)),
      aliases: (input.aliases ?? []).map((value) => redactText(boundText(value), redactions)),
      context: input.context ? redactText(boundText(input.context, 500), redactions) : undefined,
      examples: (input.examples ?? []).map((example) => ({
        ...example,
        source: redactText(boundText(example.source, 500), redactions),
        translation: example.translation ? redactText(boundText(example.translation, 500), redactions) : undefined,
      })),
      provenance: redactedProvenance.value,
    },
    redactions: Array.from(new Set(redactions)),
  };
}

function detectGlossaryConflicts(entry: GlossaryEntry, existing: GlossaryEntry[]): GlossaryConflict[] {
  const conflicts: GlossaryConflict[] = [];
  for (const other of existing) {
    if (normalize(other.sourceText) === normalize(entry.sourceText) && other.preferredTranslation !== entry.preferredTranslation) {
      conflicts.push({
        kind: 'source-preferred-mismatch',
        existingTermId: other.termId,
        message: `Source text already has preferred translation "${other.preferredTranslation}".`,
      });
    }
    if ([other.sourceText, ...other.aliases].some((value) => entry.aliases.map(normalize).includes(normalize(value)))) {
      conflicts.push({
        kind: 'alias-overlap',
        existingTermId: other.termId,
        message: 'Alias overlaps an existing glossary source or alias.',
      });
    }
  }
  if (entry.forbiddenTranslations.map(normalize).includes(normalize(entry.preferredTranslation))) {
    conflicts.push({
      kind: 'forbidden-preferred-overlap',
      message: 'Preferred translation also appears in forbidden translations.',
    });
  }
  return conflicts;
}

function extractTermCandidates(text: string): string[] {
  const normalized = text.replace(/\\[A-Za-z]+\[[^\]]+\]/g, ' ');
  return uniqueStrings(normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Z][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9ー・' -]{1,24}/gu) ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !/^---/.test(term))
    .slice(0, 12);
}

function requireProvenance(provenance: AgentProvenance | undefined): void {
  if (!provenance || !provenance.source || !provenance.createdBy || !provenance.sourceRefs?.length) {
    throw new Error('Glossary entries require provenance with source, createdBy, and at least one sourceRef.');
  }
}

function searchableGlossaryText(entry: GlossaryEntry): string {
  return normalize([entry.sourceText, entry.preferredTranslation, ...entry.forbiddenTranslations, ...entry.aliases, entry.speaker, entry.context, entry.engineType].filter(Boolean).join('\n'));
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => needle && haystack.includes(needle));
}

function boundText(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function redactText(value: string, redactions: string[]): string {
  const redacted = redactSecretLikeValues({ value });
  redactions.push(...redacted.redactions);
  return String(redacted.value.value ?? '');
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
