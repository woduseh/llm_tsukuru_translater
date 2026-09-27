import fs from 'fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TranslationCache } from '../../src/ts/libs/translationCache';
import { translateFilesWithCoordinator } from '../../src/ts/rpgmv/translator';
import { settings } from '../../src/ts/rpgmv/datas';
import * as atomic from '../../src/ts/libs/atomicFile';
import type { Translator } from '../../src/ts/libs/translatorFactory';

const roots: string[] = [];
const entry = { translatedContent: '안녕', model: 'fixture', targetLang: 'ko' };
function fixture() {
  const parent = path.resolve('artifacts/unit/translationStorage');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'case-')); roots.push(dir); return dir;
}
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });

it('durably replaces one cache entry without rewriting unrelated results', () => {
  const dir = fixture();
  const cache = new TranslationCache(dir);
  cache.set('first', entry);
  const before = fs.readdirSync(path.join(dir, '.llm_cache')).map(name => ({ name, bytes: fs.readFileSync(path.join(dir, '.llm_cache', name)) }));
  cache.set('second', { ...entry, translatedContent: '두 번째' });
  const reopened = new TranslationCache(dir);
  expect(reopened.get('first')).toEqual(entry);
  expect(reopened.get('second')?.translatedContent).toBe('두 번째');
  expect(fs.readFileSync(path.join(dir, '.llm_cache', before[0].name))).toEqual(before[0].bytes);
  reopened.delete('first');
  expect(new TranslationCache(dir).get('first')).toBeUndefined();
  expect(new TranslationCache(dir).get('second')?.translatedContent).toBe('두 번째');
});

it('resumes interrupted legacy migration without overwriting newer entries', () => {
  const dir = fixture();
  const legacy = path.join(dir, '.llm_cache.json');
  fs.writeFileSync(legacy, JSON.stringify({ version: 2, entries: { first: entry, second: entry } }));
  const write = atomic.atomicWriteJsonFile;
  let calls = 0;
  const fail = vi.spyOn(atomic, 'atomicWriteJsonFile').mockImplementation((...args) => {
    if (++calls === 2) throw new Error('disk full');
    return write(...args);
  });
  expect(() => new TranslationCache(dir)).toThrow('disk full');
  expect(fs.existsSync(legacy)).toBe(true);
  fail.mockRestore();
  const files = fs.readdirSync(path.join(dir, '.llm_cache'));
  const migrated = path.join(dir, '.llm_cache', files[0]);
  const record = JSON.parse(fs.readFileSync(migrated, 'utf8'));
  record.entry.translatedContent = '더 최신'; fs.writeFileSync(migrated, JSON.stringify(record));
  const cache = new TranslationCache(dir);
  expect(cache.get('first')?.translatedContent).toBe('더 최신');
  expect(cache.get('second')).toEqual(entry);
  expect(fs.existsSync(legacy)).toBe(false);
});

it('ignores corrupt entries and clears both cache formats without touching translations', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'Map001.txt'), '원본');
  const cache = new TranslationCache(dir); cache.set('first', entry);
  const file = fs.readdirSync(path.join(dir, '.llm_cache'))[0];
  fs.writeFileSync(path.join(dir, '.llm_cache', file), '{');
  expect(new TranslationCache(dir).get('first')).toBeUndefined();
  cache.clear();
  expect(new TranslationCache(dir).get('first')).toBeUndefined();
  expect(fs.readFileSync(path.join(dir, 'Map001.txt'), 'utf8')).toBe('원본');
});

it('loads only active source files before the first request and writes cache bytes linearly', async () => {
  const dir = fixture();
  const names = Array.from({ length: 32 }, (_, i) => `Map${i}.txt`);
  names.forEach((name, i) => fs.writeFileSync(path.join(dir, name), `--- 101 ---\nHello ${i} ${'x'.repeat(1024)}`));
  const read = fs.readFileSync;
  let reads = 0, readsAtFirstRequest = 0, requests = 0, writtenBytes = 0;
  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof file === 'string' && file.endsWith('.txt')) reads++;
    return (read as Function)(file, ...args);
  }) as typeof fs.readFileSync);
  const writeJson = atomic.atomicWriteJsonFile;
  vi.spyOn(atomic, 'atomicWriteJsonFile').mockImplementation((file, data, indent, options) => {
    if (file.includes('.llm_cache')) writtenBytes += Buffer.byteLength(JSON.stringify(data));
    return writeJson(file, data, indent, options);
  });
  const translator: Translator = {
    translateText: async text => text.replace('Hello', '안녕'),
    translateFileContent: async text => {
      if (requests++ === 0) readsAtFirstRequest = reads;
      return { translatedContent: text.replace('Hello', '안녕'), validation: [], logEntry: {} };
    },
  };
  const result = await translateFilesWithCoordinator({
    edir: dir, backupDir: dir + '_backup', fileList: names, completedFiles: new Set(),
    provider: 'gemini', model: 'fixture', sourceLang: 'en', targetLang: 'ko', settings,
    translationMode: 'all', isResuming: false, workerCount: 2, isAborted: () => false,
    createTranslatorForFile: () => translator,
  });
  expect(result.failedFiles).toEqual([]);
  expect(result.workedFiles).toBe(names.length);
  expect(readsAtFirstRequest).toBeGreaterThan(0);
  expect(readsAtFirstRequest).toBeLessThanOrEqual(2);
  expect(writtenBytes).toBeGreaterThan(1024 * names.length);
  expect(writtenBytes).toBeLessThan(2 * 1024 * names.length);
  names.forEach(name => expect(fs.readFileSync(path.join(dir, name), 'utf8')).toContain('안녕'));
});

it('cleans only stale temporary files for the selected outputs with one directory scan', () => {
  const dir = fixture();
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  for (const name of ['.A.txt.atomic-old.tmp', '.B.txt.atomic-old.tmp', '.Other.txt.atomic-old.tmp', '.A.txt.atomic-fresh.tmp']) {
    fs.writeFileSync(path.join(dir, name), 'temporary');
    if (!name.includes('fresh')) fs.utimesSync(path.join(dir, name), old, old);
  }
  const scan = vi.spyOn(fs, 'readdirSync');
  syncBuiltinESMExports();
  const cleaned = atomic.cleanupStaleAtomicTempFilesForPaths([path.join(dir, 'A.txt'), path.join(dir, 'B.txt')]);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(cleaned.removed.map(file => path.basename(file)).sort()).toEqual(['.A.txt.atomic-old.tmp', '.B.txt.atomic-old.tmp']);
  expect(fs.existsSync(path.join(dir, '.Other.txt.atomic-old.tmp'))).toBe(true);
  expect(fs.existsSync(path.join(dir, '.A.txt.atomic-fresh.tmp'))).toBe(true);
});

it('reuses a completed translation for an identical queued file', async () => {
  const dir = fixture();
  const files = ['A.txt', 'B.txt'];
  files.forEach(file => fs.writeFileSync(path.join(dir, file), '--- 101 ---\nHello'));
  const translateFileContent = vi.fn(async () => ({ translatedContent: '--- 101 ---\n안녕', validation: [], logEntry: {} }));
  const result = await translateFilesWithCoordinator({
    edir: dir, backupDir: dir + '_backup', fileList: files, completedFiles: new Set(),
    provider: 'gemini', model: 'fixture', sourceLang: 'en', targetLang: 'ko', settings,
    translationMode: 'all', isResuming: false, workerCount: 1, isAborted: () => false,
    createTranslatorForFile: () => ({ translateText: async () => '안녕', translateFileContent }),
  });
  expect(result.workedFiles).toBe(2);
  expect(result.failedFiles).toEqual([]);
  expect(translateFileContent).toHaveBeenCalledTimes(1);
  expect(result.entries.filter(entry => entry.cached)).toHaveLength(1);
  files.forEach(file => expect(fs.readFileSync(path.join(dir, file), 'utf8')).toBe('--- 101 ---\n안녕'));
});

it('recovers valid entries from mixed legacy data and preserves the original without resurrecting invalidated values', () => {
  const dir = fixture();
  const legacy = path.join(dir, '.llm_cache.json');
  const bytes = JSON.stringify({ version: 2, entries: { good: entry, bad: { broken: true } } });
  fs.writeFileSync(legacy, bytes);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const cache = new TranslationCache(dir);
  expect(cache.get('good')).toEqual(entry);
  expect(cache.get('bad')).toBeUndefined();
  expect(fs.readFileSync(legacy, 'utf8')).toBe(bytes);
  expect(warning).toHaveBeenCalled();
  cache.delete('good');
  expect(new TranslationCache(dir).get('good')).toBeUndefined();
  expect(fs.readFileSync(legacy, 'utf8')).toBe(bytes);
});

it.each(['{broken', '{"version":99,"entries":{}}', '{"version":2,"entries":[]}'])('preserves unrecognized legacy bytes: %s', bytes => {
  const dir = fixture(); const legacy = path.join(dir, '.llm_cache.json');
  fs.writeFileSync(legacy, bytes);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(new TranslationCache(dir).get('missing')).toBeUndefined();
  expect(fs.readFileSync(legacy, 'utf8')).toBe(bytes);
});
