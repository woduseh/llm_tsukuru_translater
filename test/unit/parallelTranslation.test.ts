import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import {
  resolveLlmParallelWorkers,
  translateFilesWithCoordinator,
  validateTranslatedFileContent,
} from '../../src/ts/rpgmv/translator';
import { buildTranslationCacheKey, type Translator } from '../../src/ts/libs/translatorFactory';
import { contentHash, type BlockValidation } from '../../src/ts/libs/translationCore';

const sandboxRoot = path.resolve('artifacts', 'unit', 'parallelTranslation');
const createdDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parallel translation coordinator', () => {
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
    expect(maxActive).toBeLessThanOrEqual(workers);
    for (const file of files) {
      expect(fs.readFileSync(path.join(edir, file), 'utf-8')).toContain('번역');
    }
  });

  it('uses valid cache hits without starting workers', async () => {
    const { edir, backupDir, files } = makeProject(['Cached.txt']);
    const original = fs.readFileSync(path.join(edir, files[0]), 'utf-8');
    const translated = translateContent(original);
    const cacheKey = buildTranslationCacheKey('gemini', contentHash(original), 'mock-model', 'ko');
    const cache = {
      [cacheKey]: { translatedContent: translated, model: 'mock-model', targetLang: 'ko', provider: 'gemini' },
    };
    let workerCalls = 0;

    const result = await translateFilesWithCoordinator({
      ...baseOptions(edir, backupDir, files, 4, cache),
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
  it('caps requested workers by provider registry metadata', () => {
    expect(resolveLlmParallelWorkers('gemini', 99)).toBeGreaterThanOrEqual(1);
    expect(resolveLlmParallelWorkers('gemini', 99)).toBeLessThanOrEqual(16);
    expect(resolveLlmParallelWorkers('gemini', 0)).toBe(1);
  });

  it('detects separator, empty-line, line-count, and control-code regressions', () => {
    const original = '--- 1 ---\n\\C[1]Hello\n\nWorld';
    expect(validateTranslatedFileContent(original, '--- 2 ---\n\\C[1]Hello\n\nWorld').ok).toBe(false);
    expect(validateTranslatedFileContent(original, '--- 1 ---\nHello\n\nWorld').ok).toBe(false);
    expect(validateTranslatedFileContent(original, '--- 1 ---\n\\C[1]Hello\nfilled\nWorld').ok).toBe(false);
    expect(validateTranslatedFileContent(original, '--- 1 ---\n\\C[1]Hello\n\nWorld\nextra').ok).toBe(false);
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
