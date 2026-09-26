import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { atomicWriteJsonFile, cleanupStaleAtomicTempFilesForPaths } from './atomicFile';
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
    let parsed: { version?: unknown; entries?: unknown };
    try { parsed = JSON.parse(bytes); } catch { parsed = {}; }
    const entries = parsed?.version === LLM_FINGERPRINT_SCHEMA_VERSION && isStore(parsed.entries) ? parsed.entries : {};
    for (const [key, entry] of Object.entries(entries)) {
      // An interrupted migration may already have newer per-key values. Never overwrite them.
      if (!this.readDisk(key)) this.set(key, entry);
    }
    // No deletion until every valid legacy entry has a durable replacement.
    fs.unlinkSync(this.legacyPath);
  }
}

function isEntry(value: unknown): value is TranslationCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.translatedContent === 'string' && typeof entry.model === 'string'
    && typeof entry.targetLang === 'string' && (entry.provider === undefined || typeof entry.provider === 'string');
}

function isStore(value: unknown): value is CacheStore {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isEntry);
}
