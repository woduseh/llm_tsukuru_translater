import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import {
  isMatchingTranslationProgress,
  resolveLlmParallelWorkers,
  translateFilesWithCoordinator,
  validateTranslatedFileContent,
} from '../../src/ts/rpgmv/translator';
import { buildTranslationCacheKey, type Translator } from '../../src/ts/libs/translatorFactory';
import { LLM_FINGERPRINT_SCHEMA_VERSION } from '../../src/ts/libs/providerRegistry';
import { contentHash, type BlockValidation } from '../../src/ts/libs/translationCore';
import * as atomicFile from '../../src/ts/libs/atomicFile';
import { ProviderTranslationBase, type ProviderTranslationConfig } from '../../src/ts/libs/providerTranslationBase';

const sandboxRoot = path.resolve('artifacts', 'unit', 'parallelTranslation');
const createdDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parallel translation coordinator', () => {
  it('shares a server 429 cooldown across files and retries only the failed request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const project = makeProject(['A.txt', 'B.txt', 'C.txt']);
    const attempts: { text: string; at: number }[] = [];
    let failedOnce = false;
    const job = translateFilesWithCoordinator({
      ...baseOptions(project.edir, project.backupDir, project.files, 2),
      createTranslatorForFile: () => chunkTranslator(async (text) => {
        attempts.push({ text, at: Date.now() });
        await delay(1);
        if (text.includes('A.txt') && !failedOnce) {
          failedOnce = true;
          throw Object.assign(new Error('busy'), { status: 429, retryAfterMs: 5000 });
        }
        return translateContent(text);
      }, { maxApiRetries: 1 }),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toHaveLength(2);
    await vi.runAllTimersAsync();
    expect((await job).failedFiles).toEqual([]);
    expect(attempts).toHaveLength(4);
    expect(attempts.slice(2).every((request) => request.at >= 5001)).toBe(true);
    expect(attempts.filter((request) => request.text.includes('A.txt'))).toHaveLength(2);
    expect(attempts.filter((request) => request.text.includes('B.txt'))).toHaveLength(1);
    expect(attempts.filter((request) => request.text.includes('C.txt'))).toHaveLength(1);
  });

  it('propagates a one-time chunk progress failure after draining requests instead of reporting completion', async () => {
    vi.useFakeTimers();
    const project = makeProject(['A.txt', 'B.txt', 'C.txt']);
    const options = baseOptions(project.edir, project.backupDir, project.files, 2);
    let active = 0;
    let calls = 0;
    let thrown = false;
    const job = translateFilesWithCoordinator({
      ...options,
      onProgress: (progress) => {
        if (progress > 0 && !thrown) {
          thrown = true;
          throw new Error('progress delivery failed');
        }
      },
      createTranslatorForFile: () => chunkTranslator(async (text) => {
        calls++;
        active++;
        await delay(text.includes('A.txt') ? 10 : 100);
        active--;
        return translateContent(text);
      }),
    });
    const rejected = expect(job).rejects.toThrow('progress delivery failed');
    await vi.runAllTimersAsync();
    await rejected;
    expect(active).toBe(0);
    expect(calls).toBe(2);
    expect(options.completedFiles.size).toBe(0);
    expect(Object.keys(options.cache)).toHaveLength(0);
    for (const file of project.files) expect(fs.readFileSync(path.join(project.edir, file), 'utf8')).not.toContain('번역');
  });

  it.each([2, 4])('shares a %i-request limit across files and chunks with monotonic total progress', async (workers) => {
    vi.useFakeTimers();
    const project = makeProject(['A.txt', 'B.txt', 'C.txt', 'D.txt']);
    const original = '--- 1 ---\n\\C[1]One\n\n--- 2 ---\nTwo\n--- 3 ---\nThree\n';
    for (const file of project.files) fs.writeFileSync(path.join(project.edir, file), original);
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const progress: number[] = [];
    const options = baseOptions(project.edir, project.backupDir, project.files, workers);
    const job = translateFilesWithCoordinator({
      ...options,
      onProgress: (value) => progress.push(value),
      createTranslatorForFile: () => chunkTranslator(async (text) => {
        calls++;
        maxActive = Math.max(maxActive, ++active);
        await delay(text.includes('One') ? 100 : 10);
        active--;
        return translateContent(text);
      }),
    });
    await vi.runAllTimersAsync();
    const result = await job;
    expect(result.failedFiles).toEqual([]);
    expect(result.workedFiles).toBe(4);
    expect(maxActive).toBe(workers);
    expect(calls).toBe(12);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(100);
    for (const file of project.files) expect(fs.readFileSync(path.join(project.edir, file), 'utf8')).toBe(translateContent(original));
    expect(options.completedFiles.size).toBe(4);
    expect(Object.keys(options.cache)).toHaveLength(1);
  });

  it('drops queued chunk requests on cancellation and never commits an unfinished file', async () => {
    vi.useFakeTimers();
    const project = makeProject(['A.txt', 'B.txt', 'C.txt']);
    const original = '--- 1 ---\nOne\n--- 2 ---\nTwo\n--- 3 ---\nThree';
    for (const file of project.files) fs.writeFileSync(path.join(project.edir, file), original);
    const options = baseOptions(project.edir, project.backupDir, project.files, 2);
    let aborted = false;
    let active = 0;
    let calls = 0;
    const job = translateFilesWithCoordinator({
      ...options, isAborted: () => aborted,
      createTranslatorForFile: () => chunkTranslator(async (text) => {
        calls++;
        active++;
        await delay(100);
        active--;
        return translateContent(text);
      }),
    });
    await vi.advanceTimersByTimeAsync(1);
    aborted = true;
    await vi.runAllTimersAsync();
    expect((await job).workedFiles).toBe(0);
    expect(calls).toBe(2);
    expect(active).toBe(0);
    expect(options.completedFiles.size).toBe(0);
    expect(Object.keys(options.cache)).toHaveLength(0);
    expect(fs.existsSync(path.join(project.edir, '.llm_progress.json'))).toBe(false);
    for (const file of project.files) expect(fs.readFileSync(path.join(project.edir, file), 'utf8')).toBe(original);
  });

  it('keeps the complete source file when one concurrently translated chunk is invalid', async () => {
    const project = makeProject(['A.txt']);
    const original = '--- 1 ---\nOne\n--- 2 ---\nTwo';
    fs.writeFileSync(path.join(project.edir, 'A.txt'), original);
    const options = baseOptions(project.edir, project.backupDir, project.files, 2);
    const result = await translateFilesWithCoordinator({
      ...options,
      createTranslatorForFile: () => chunkTranslator(async (text) => text.includes('Two') ? 'bad\nextra\nlines' : translateContent(text)),
    });
    expect(result.failedFiles).toEqual(['A.txt']);
    expect(fs.readFileSync(path.join(project.edir, 'A.txt'), 'utf8')).toBe(original);
    expect(options.completedFiles.size).toBe(0);
    expect(Object.keys(options.cache)).toHaveLength(0);
  });

  it.each([1, 2, 4])('translates files with at most %i active workers', async (workers) => {
    const { edir, backupDir, files } = makeProject(['A.txt', 'B.txt', 'C.txt', 'D.txt']);
    let active = 0;
    let maxActive = 0;

    const result = await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, workers),
      createTranslatorForFile: () => fakeTranslator(async (content) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active--;
        return translateContent(content);
      }),
    });

    expect(result.failedFiles).toEqual([]);
    expect(result.workedFiles).toBe(files.length);
    expect(maxActive).toBe(workers);
    for (const file of files) {
      expect(fs.readFileSync(path.join(edir, file), 'utf-8')).toContain('번역');
    }
  });

  it('uses valid cache hits without starting workers', async () => {
    const { edir, backupDir, files } = makeProject(['Cached.txt']);
    const original = fs.readFileSync(path.join(edir, files[0]), 'utf-8');
    const translated = translateContent(original);
    const options = baseOptions(edir, backupDir, files, 4);
    const cacheKey = buildTranslationCacheKey(
      'gemini', contentHash(original), 'mock-model', 'ja', 'ko', options.settings,
    );
    const cache = {
      [cacheKey]: { translatedContent: translated, model: 'mock-model', targetLang: 'ko', provider: 'gemini' },
    };
    let workerCalls = 0;

    const result = await translateFilesWithCoordinator({
      ...options,
      cache,
      createTranslatorForFile: () => {
        workerCalls++;
        return fakeTranslator(async (content) => translateContent(content));
      },
    });

    expect(workerCalls).toBe(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].cached).toBe(true);
    expect(fs.readFileSync(path.join(edir, files[0]), 'utf-8')).toBe(translated);
    expect(readProgress(edir).completedFiles).toEqual(['Cached.txt']);
  });

  it('falls through to a fresh translation after deleting an invalid cache hit', async () => {
    const { edir, backupDir, files } = makeProject(['Stale.txt']);
    const original = fs.readFileSync(path.join(edir, files[0]), 'utf-8');
    const options = baseOptions(edir, backupDir, files, 1);
    const cacheKey = buildTranslationCacheKey(
      'gemini', contentHash(original), 'mock-model', 'ja', 'ko', options.settings,
    );
    const cache = {
      [cacheKey]: { translatedContent: 'BROKEN', model: 'mock-model', targetLang: 'ko', provider: 'gemini' },
    };
    let workerCalls = 0;

    const result = await translateFilesWithCoordinator({
      ...options,
      cache,
      createTranslatorForFile: () => {
        workerCalls++;
        return fakeTranslator(async (content) => translateContent(content));
      },
    });

    expect(workerCalls).toBe(1);
    expect(result.failedFiles).toEqual([]);
    expect(fs.readFileSync(path.join(edir, files[0]), 'utf-8')).toContain('번역');
    expect(cache[cacheKey].translatedContent).toContain('번역');
  });

  it('reports stable file ordinals for concurrently started workers', async () => {
    const { edir, backupDir, files } = makeProject(['One.txt', 'Two.txt', 'Three.txt']);
    const statuses: string[] = [];

    await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 2),
      onStatus: (message) => statuses.push(message),
      createTranslatorForFile: () => fakeTranslator(async (content) => {
        await delay(10);
        return translateContent(content);
      }),
    });

    const startedStatuses = statuses.filter((message) => /^\[\d+\/\d+\] [^.]+\.txt$/.test(message));
    expect(startedStatuses).toContain('[1/3] One.txt');
    expect(startedStatuses).toContain('[2/3] Two.txt');
    expect(startedStatuses.filter((message) => message.startsWith('[1/3]'))).toHaveLength(1);
  });

  it('keeps the original file and avoids progress/cache updates when validation fails', async () => {
    const { edir, backupDir, files } = makeProject(['Bad.txt']);
    const original = fs.readFileSync(path.join(edir, files[0]), 'utf-8');
    const cache: Record<string, { translatedContent: string; model: string; targetLang: string; provider?: string }> = {};

    const result = await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 2, cache),
      createTranslatorForFile: () => fakeTranslator(async () => 'BROKEN'),
    });

    expect(result.failedFiles).toEqual(['Bad.txt']);
    expect(fs.readFileSync(path.join(edir, files[0]), 'utf-8')).toBe(original);
    expect(fs.existsSync(path.join(edir, '.llm_progress.json'))).toBe(false);
    expect(Object.keys(cache)).toHaveLength(0);
  });

  it('does not write, cache, or complete progress when any provider chunk failed terminally', async () => {
    const { edir, backupDir, files } = makeProject(['Partial.txt']);
    const original = fs.readFileSync(path.join(edir, files[0]), 'utf-8');
    const translated = translateContent(original);
    const cache: Record<string, { translatedContent: string; model: string; targetLang: string; provider?: string }> = {};

    const result = await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 1, cache),
      createTranslatorForFile: () => ({
        translateText: async (text) => text,
        translateFileContent: async () => ({
          translatedContent: translated,
          validation: validBlockValidation(original, translated),
          logEntry: { ...logEntry(), translatedBlocks: 0, errorBlocks: 1, errors: ['terminal failure'] },
        }),
      }),
    });

    expect(result.failedFiles).toEqual(['Partial.txt']);
    expect(result.totalErrors).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(edir, files[0]), 'utf-8')).toBe(original);
    expect(fs.existsSync(path.join(edir, '.llm_progress.json'))).toBe(false);
    expect(Object.keys(cache)).toHaveLength(0);
  });

  it.each(['creation', 'request'])('records provider %s failures and continues with queued files', async (failurePhase) => {
    const { edir, backupDir, files } = makeProject(['Failed.txt', 'Next.txt']);
    const options = baseOptions(edir, backupDir, files, 1);
    const failedPath = path.join(edir, files[0]);
    const original = fs.readFileSync(failedPath, 'utf-8');
    const providerError = new Error('provider unavailable');

    const result = await translateFilesWithCoordinator({
      ...options,
      createTranslatorForFile: (fileName) => {
        if (fileName === 'Failed.txt' && failurePhase === 'creation') throw providerError;
        return fakeTranslator(async (content) => {
          if (fileName === 'Failed.txt') throw providerError;
          return translateContent(content);
        });
      },
    });

    expect(result.failedFiles).toEqual(['Failed.txt']);
    expect(result.workedFiles).toBe(2);
    expect(result.entries[0]).toMatchObject({ fileName: 'Failed.txt', errorBlocks: 1, errors: ['provider unavailable'] });
    expect(fs.readFileSync(failedPath, 'utf-8')).toBe(original);
    expect(readProgress(edir).completedFiles).toEqual(['Next.txt']);
    expect(Object.keys(options.cache)).toHaveLength(1);
  });

  it('propagates commit failures after in-flight workers settle and stops dequeuing new files', async () => {
    const { edir, backupDir, files } = makeProject(['Failed.txt', 'InFlight.txt', 'Queued.txt']);
    const options = baseOptions(edir, backupDir, files, 2);
    const failedPath = path.join(edir, files[0]);
    const original = fs.readFileSync(failedPath, 'utf-8');
    const commitError = new Error('translation file commit failed');
    let signalCommitFailure!: () => void;
    const commitFailed = new Promise<void>((resolve) => { signalCommitFailure = resolve; });
    let releaseInFlight!: () => void;
    const inFlight = new Promise<void>((resolve) => { releaseInFlight = resolve; });
    const started: string[] = [];
    const writeTextFile = atomicFile.atomicWriteTextFile;
    vi.spyOn(atomicFile, 'atomicWriteTextFile').mockImplementation((filePath, content, writeOptions) => {
      if (filePath === failedPath) {
        signalCommitFailure();
        throw commitError;
      }
      writeTextFile(filePath, content, writeOptions);
    });

    let settled = false;
    const outcome = translateFilesWithCoordinator({
      ...options,
      createTranslatorForFile: (fileName) => fakeTranslator(async (content) => {
        started.push(fileName);
        if (fileName === 'InFlight.txt') await inFlight;
        return translateContent(content);
      }),
    }).then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    ).finally(() => { settled = true; });

    await commitFailed;
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally {
      releaseInFlight();
    }

    expect((await outcome).error).toBe(commitError);
    expect(started).toEqual(['Failed.txt', 'InFlight.txt']);
    expect(fs.readFileSync(failedPath, 'utf-8')).toBe(original);
    expect(fs.readFileSync(path.join(edir, 'Queued.txt'), 'utf-8')).not.toContain('번역');
    expect(fs.readFileSync(path.join(edir, 'InFlight.txt'), 'utf-8')).toContain('번역');
    expect(readProgress(edir).completedFiles).toEqual(['InFlight.txt']);
    expect([...options.completedFiles]).toEqual(['InFlight.txt']);
    expect(Object.keys(options.cache)).toHaveLength(1);
    const persistedCache = JSON.parse(fs.readFileSync(path.join(edir, '.llm_cache.json'), 'utf-8'));
    expect(Object.keys(persistedCache.entries)).toEqual(Object.keys(options.cache));
  });

  it('stops dequeuing queued files after abort while saving completed successes', async () => {
    const { edir, backupDir, files } = makeProject(['One.txt', 'Two.txt', 'Three.txt']);
    let aborted = false;
    const started: string[] = [];

    const result = await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 1),
      isAborted: () => aborted,
      createTranslatorForFile: (fileName) => fakeTranslator(async (content) => {
        started.push(fileName);
        aborted = true;
        return translateContent(content);
      }),
    });

    expect(started).toEqual(['One.txt']);
    expect(result.workedFiles).toBe(1);
    expect(readProgress(edir).completedFiles).toEqual(['One.txt']);
    expect(fs.readFileSync(path.join(edir, 'Two.txt'), 'utf-8')).not.toContain('번역');
  });

  it('waits for in-flight workers on abort and does not save aborted partial results', async () => {
    const { edir, backupDir, files } = makeProject(['One.txt', 'Two.txt', 'Three.txt']);
    let aborted = false;
    const started: string[] = [];

    await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 2),
      isAborted: () => aborted,
      createTranslatorForFile: (fileName) => ({
        translateText: async (text) => text,
        translateFileContent: async (content) => {
          started.push(fileName);
          if (started.length === 2) {
            aborted = true;
          }
          await delay(fileName === 'One.txt' ? 2 : 5);
          return {
            translatedContent: translateContent(content),
            validation: validBlockValidation(content, translateContent(content)),
            logEntry: logEntry(),
            aborted: fileName === 'Two.txt',
          };
        },
      }),
    });

    expect(started).toEqual(['One.txt', 'Two.txt']);
    expect(fs.readFileSync(path.join(edir, 'One.txt'), 'utf-8')).toContain('번역');
    expect(fs.readFileSync(path.join(edir, 'Two.txt'), 'utf-8')).not.toContain('번역');
    expect(readProgress(edir).completedFiles).toEqual(['One.txt']);
  });

  it('resumes completed progress without re-translating completed files', async () => {
    const { edir, backupDir, files } = makeProject(['Done.txt', 'Todo.txt']);
    const completedFiles = new Set(['Done.txt']);
    const started: string[] = [];

    await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 2),
      completedFiles,
      isResuming: true,
      createTranslatorForFile: (fileName) => fakeTranslator(async (content) => {
        started.push(fileName);
        return translateContent(content);
      }),
    });

    expect(started).toEqual(['Todo.txt']);
    expect([...completedFiles].sort()).toEqual(['Done.txt', 'Todo.txt']);
  });
});

describe('parallel translation safeguards', () => {
  it('bounds concurrency without forcing a provider to one worker', () => {
    expect(resolveLlmParallelWorkers('gemini', 99)).toBeGreaterThanOrEqual(1);
    expect(resolveLlmParallelWorkers('gemini', 99)).toBe(8);
    expect(resolveLlmParallelWorkers('gemini', 0)).toBe(1);
    for (const provider of ['gemini', 'vertex', 'openai', 'custom-openai', 'claude']) {
      expect(resolveLlmParallelWorkers(provider, 4)).toBe(4);
    }
  });

  it('detects separator, empty-line, line-count, and control-code regressions', () => {
    const original = '--- 1 ---\n\\C[1]Hello\n\nWorld';
    expect(validateTranslatedFileContent(original, '--- 2 ---\n\\C[1]Hello\n\nWorld').ok).toBe(false);
    expect(validateTranslatedFileContent(original, '--- 1 ---\nHello\n\nWorld').ok).toBe(false);
    expect(validateTranslatedFileContent(original, '--- 1 ---\n\\C[1]Hello\nfilled\nWorld').ok).toBe(false);
    expect(validateTranslatedFileContent(original, '--- 1 ---\n\\C[1]Hello\n\nWorld\nextra').ok).toBe(false);
  });

  it('rejects legacy or mismatched progress fingerprints', () => {
    expect(isMatchingTranslationProgress({
      version: 0,
      fingerprint: '',
      completedFiles: ['Done.txt'],
      timestamp: '',
    }, 'llm-config-v2-gemini')).toBe(false);
    expect(isMatchingTranslationProgress({
      version: LLM_FINGERPRINT_SCHEMA_VERSION,
      fingerprint: 'llm-config-v2-gemini-a',
      completedFiles: ['Done.txt'],
      timestamp: '',
    }, 'llm-config-v2-gemini-b')).toBe(false);
    expect(isMatchingTranslationProgress({
      version: LLM_FINGERPRINT_SCHEMA_VERSION,
      fingerprint: 'llm-config-v2-gemini-a',
      completedFiles: ['Done.txt'],
      timestamp: '',
    }, 'llm-config-v2-gemini-a')).toBe(true);
  });
});

function baseOptions(
  edir: string,
  backupDir: string,
  fileList: string[],
  workerCount: number,
  cache: Record<string, { translatedContent: string; model: string; targetLang: string; provider?: string }> = {},
) {
  return {
    edir,
    backupDir,
    fileList,
    completedFiles: new Set<string>(),
    cache,
    provider: 'gemini',
    model: 'mock-model',
    sourceLang: 'ja',
    targetLang: 'ko',
    settings: { ...defaultSettings, llmModel: 'mock-model', llmApiKey: 'test-key' },
    translationMode: 'all',
    isResuming: false,
    workerCount,
    isAborted: () => false,
  };
}

function makeProject(fileNames: string[]): { edir: string; backupDir: string; files: string[] } {
  const root = path.join(sandboxRoot, `${process.pid}-${Date.now()}-${sequence++}`);
  const edir = path.join(root, 'Extract');
  const backupDir = `${edir}_backup`;
  fs.mkdirSync(edir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  createdDirs.push(root);
  for (const fileName of fileNames) {
    const content = `--- 1 ---\n\\C[1]${fileName}\n\nLine`;
    fs.writeFileSync(path.join(edir, fileName), content, 'utf-8');
    fs.writeFileSync(path.join(backupDir, fileName), content, 'utf-8');
  }
  return { edir, backupDir, files: fileNames };
}

function fakeTranslator(translate: (content: string) => Promise<string>): Translator {
  return {
    translateText: translate,
    translateFileContent: async (content) => {
      const translatedContent = await translate(content);
      return {
        translatedContent,
        validation: validBlockValidation(content, translatedContent),
        logEntry: logEntry(),
      };
    },
  };
}

function chunkTranslator(translate: (text: string) => Promise<string>, overrides: Partial<ProviderTranslationConfig> = {}): Translator {
  return new class extends ProviderTranslationBase {
    constructor() {
      super({ chunkSize: 1, translationUnit: 'chunk', doNotTransHangul: false, maxRetries: 0, maxApiRetries: 0, ...overrides });
    }
    translateText = translate;
  }();
}

function translateContent(content: string): string {
  return content.split('\n').map((line) => {
    if (line === '' || /^---\s*\d+\s*---$/.test(line)) {
      return line;
    }
    return `${line} 번역`;
  }).join('\n');
}

function validBlockValidation(original: string, translated: string): BlockValidation[] {
  return [{
    index: 0,
    separator: '--- 1 ---',
    originalLines: original.split('\n').slice(1),
    translatedLines: translated.split('\n').slice(1),
    lineCountMatch: original.split('\n').length === translated.split('\n').length,
    separatorMatch: true,
  }];
}

function logEntry() {
  return {
    totalBlocks: 1,
    translatedBlocks: 1,
    skippedBlocks: 0,
    errorBlocks: 0,
    retries: 0,
    durationMs: 1,
    errors: [],
  };
}

function readProgress(edir: string): { completedFiles: string[] } {
  return JSON.parse(fs.readFileSync(path.join(edir, '.llm_progress.json'), 'utf-8')) as { completedFiles: string[] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
