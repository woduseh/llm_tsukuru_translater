import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { atomicWriteJsonFile, atomicWriteTextFile, cleanupStaleAtomicTempFilesForPaths } from './atomicFile';
import { LLM_FINGERPRINT_SCHEMA_VERSION } from './providerRegistry';

export interface TranslationCacheEntry {
  translatedContent: string;
  model: string;
  targetLang: string;
  provider?: string;
}
export type CacheStore = Record<string, TranslationCacheEntry>;
export const TRANSLATION_CACHE_DIRECTORY = '.llm_cache';
const LEGACY_CACHE_FILE = '.llm_cache.json';

/** One atomic file per key. Production reads are lazy; an optional map is useful for callers supplying a cache. */
export class TranslationCache {
  private readonly directory: string;
  private readonly legacyPath: string;
  private directoryReady = false;

  constructor(edir: string, private readonly memory?: CacheStore) {
    this.directory = path.join(edir, TRANSLATION_CACHE_DIRECTORY);
    this.legacyPath = path.join(edir, LEGACY_CACHE_FILE);
    this.directoryReady = fs.existsSync(this.directory);
    if (this.directoryReady) {
      // Only crash leftovers need a cleanup pass; normal reads do not enumerate cache values.
      const targets = new Set<string>();
      for (const name of fs.readdirSync(this.directory)) {
        const match = /^\.([a-f0-9]{64}\.json)\.atomic-.*\.tmp$/.exec(name);
        if (match) targets.add(path.join(this.directory, match[1]));
      }
      cleanupStaleAtomicTempFilesForPaths([...targets]);
    }
    this.migrateLegacy();
  }

  get(key: string): TranslationCacheEntry | undefined {
    return this.memory?.[key] ?? this.readDisk(key);
  }

  set(key: string, entry: TranslationCacheEntry): void {
    if (!this.directoryReady) {
      fs.mkdirSync(this.directory, { recursive: true });
      this.directoryReady = true;
    }
    atomicWriteJsonFile(this.entryPath(key), {
      version: LLM_FINGERPRINT_SCHEMA_VERSION, key, entry,
    }, 0, { cleanupStaleTempFiles: false });
    if (this.memory) this.memory[key] = entry;
  }

  delete(key: string): void {
    fs.rmSync(this.entryPath(key), { force: true });
    if (this.memory) delete this.memory[key];
  }

  clear(): void {
    fs.rmSync(this.directory, { recursive: true, force: true });
    fs.rmSync(this.legacyPath, { force: true });
    this.directoryReady = false;
    if (this.memory) for (const key of Object.keys(this.memory)) delete this.memory[key];
  }

  private entryPath(key: string): string {
    return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  private readDisk(key: string): TranslationCacheEntry | undefined {
    try {
      const record = JSON.parse(fs.readFileSync(this.entryPath(key), 'utf8'));
      return record?.version === LLM_FINGERPRINT_SCHEMA_VERSION && record.key === key && isEntry(record.entry)
        ? record.entry : undefined;
    } catch {
      // Cache state is disposable; invalid/missing entries are fresh translations, not successes.
      return undefined;
    }
  }

  private migrateLegacy(): void {
    if (!fs.existsSync(this.legacyPath)) return;
    const bytes = fs.readFileSync(this.legacyPath, 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const checkpoint = path.join(this.directory, 'legacy-import.sha256');
    // Retained mixed data must not resurrect an entry invalidated after its first import.
    if (fs.existsSync(checkpoint) && fs.readFileSync(checkpoint, 'utf8') === digest) return;
    let parsed: { version?: unknown; entries?: unknown };
    try { parsed = JSON.parse(bytes); } catch { parsed = {}; }
    if (parsed?.version !== LLM_FINGERPRINT_SCHEMA_VERSION || !parsed.entries
      || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      console.warn('Unrecognized legacy translation cache retained unchanged; fresh translations will use per-key cache.');
      return;
    }
    let invalidEntries = 0;
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (!isEntry(entry)) { invalidEntries++; continue; }
      // An interrupted migration may already have newer per-key values. Never overwrite them.
      if (!this.readDisk(key)) this.set(key, entry);
    }
    if (fs.readFileSync(this.legacyPath, 'utf8') !== bytes) {
      console.warn('Legacy translation cache changed during migration; original retained.');
      return;
    }
    if (invalidEntries > 0) {
      fs.mkdirSync(this.directory, { recursive: true });
      this.directoryReady = true;
      atomicWriteTextFile(checkpoint, digest);
      console.warn(`Legacy translation cache contains ${invalidEntries} invalid entries; valid entries imported and original retained unchanged.`);
      return;
    }
    // Delete only an unchanged, fully recognized legacy file after durable import.
    fs.unlinkSync(this.legacyPath);
    fs.rmSync(checkpoint, { force: true });
  }
}

function isEntry(value: unknown): value is TranslationCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.translatedContent === 'string' && typeof entry.model === 'string'
    && typeof entry.targetLang === 'string' && (entry.provider === undefined || typeof entry.provider === 'string');
}
