import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { AppContext } from '../../src/appContext';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import { retranslateBlocks, retranslateFile } from '../../src/ts/rpgmv/translator';

const sandboxRoot = path.resolve('artifacts', 'unit', 'retranslation');
const createdDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('selected-block retranslation safeguards', () => {
  it('rejects a response with fewer blocks and leaves the file byte-identical', async () => {
    const project = makeProject();
    mockGeminiResponse('--- 101-0 ---\n\\C[1]새 번역\n');

    const result = await retranslateBlocks(
      project.edir, project.fileName, [0, 1], 'ja', 'ko', createContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('블록 수');
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(project.currentContent);
  });

  it.each([
    ['separator', '--- 999 ---\n\\C[1]새 번역\n'],
    ['empty line', '--- 101-0 ---\n\\C[1]새 번역\n채워짐'],
    ['control code', '--- 101-0 ---\n\\C[2]새 번역\n'],
  ])('rejects %s drift before writing', async (_caseName, providerText) => {
    const project = makeProject();
    mockGeminiResponse(providerText);

    const result = await retranslateBlocks(
      project.edir, project.fileName, [0], 'ja', 'ko', createContext(),
    );

    expect(result.success).toBe(false);
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(project.currentContent);
  });

  it('writes atomically only after selected and final file validation pass', async () => {
    const project = makeProject();
    const translated = '--- 101-0 ---\n\\C[1]새 번역\n\n--- 101-1 ---\n새 세계';
    mockGeminiResponse(translated);

    const result = await retranslateBlocks(
      project.edir, project.fileName, [0, 1], 'ja', 'ko', createContext(),
    );

    expect(result).toEqual({ success: true });
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(translated);
    const cacheFile = JSON.parse(fs.readFileSync(path.join(project.edir, '.llm_cache.json'), 'utf-8'));
    expect(cacheFile).toMatchObject({ version: 2, entries: {} });
  });

  it('does not overwrite an edit made while a selected-block request is in flight', async () => {
    const project = makeProject();
    let resolveResponse: ((value: unknown) => void) | undefined;
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }) as ReturnType<typeof axios.post>);

    const pending = retranslateBlocks(
      project.edir, project.fileName, [0, 1], 'ja', 'ko', createContext(),
    );
    await vi.waitFor(() => expect(resolveResponse).toBeTypeOf('function'));

    const newerEdit = `${project.currentContent}\n최신 수정`;
    fs.writeFileSync(project.filePath, newerEdit, 'utf-8');
    resolveResponse?.({
      data: {
        candidates: [{ content: { parts: [{ text: '--- 101-0 ---\n\\C[1]새 번역\n\n--- 101-1 ---\n새 세계' }] } }],
      },
    });

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toContain('파일이 변경');
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(newerEdit);
  });

  it('serializes requests for the same extract directory and rejects a queued stale preimage', async () => {
    const project = makeProject();
    let resolveResponse: ((value: unknown) => void) | undefined;
    const post = vi.spyOn(axios, 'post').mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }) as ReturnType<typeof axios.post>);
    const context = createContext();

    const first = retranslateBlocks(
      project.edir, project.fileName, [0, 1], 'ja', 'ko', context, undefined, project.currentContent,
    );
    await vi.waitFor(() => expect(resolveResponse).toBeTypeOf('function'));

    const second = retranslateBlocks(
      project.edir, project.fileName, [0, 1], 'ja', 'ko', context, undefined, project.currentContent,
    );
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);

    resolveResponse?.({
      data: {
        candidates: [{ content: { parts: [{ text: '--- 101-0 ---\n\\C[1]새 번역\n\n--- 101-1 ---\n새 세계' }] } }],
      },
    });

    expect(await first).toEqual({ success: true });
    const secondResult = await second;
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toContain('파일이 변경');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate or missing indices without calling the provider', async () => {
    const project = makeProject();
    const post = vi.spyOn(axios, 'post');

    const duplicate = await retranslateBlocks(
      project.edir, project.fileName, [0, 0], 'ja', 'ko', createContext(),
    );
    const outOfRange = await retranslateBlocks(
      project.edir, project.fileName, [99], 'ja', 'ko', createContext(),
    );

    expect(duplicate.success).toBe(false);
    expect(outOfRange.success).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(project.currentContent);
  });
});

describe('full-file retranslation failure propagation', () => {
  it('does not write or cache a fallback produced by a terminal provider failure', async () => {
    const project = makeProject();
    fs.writeFileSync(path.join(project.edir, '.llm_cache.json'), JSON.stringify({
      legacyKey: {
        translatedContent: 'legacy translation',
        model: 'legacy-model',
        targetLang: 'ko',
      },
    }), 'utf-8');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('blocked by provider'));

    const result = await retranslateFile(
      project.edir, project.fileName, 'ja', 'ko', createContext(),
    );

    expect(result.success).toBe(false);
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(project.currentContent);
    const cacheFile = JSON.parse(fs.readFileSync(path.join(project.edir, '.llm_cache.json'), 'utf-8'));
    expect(cacheFile).toMatchObject({ version: 2, entries: {} });
    expect(fs.existsSync(path.join(project.edir, '.llm_progress.json'))).toBe(false);
  });

  it('does not overwrite an edit made while a full-file request is in flight', async () => {
    const project = makeProject();
    let resolveResponse: ((value: unknown) => void) | undefined;
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }) as ReturnType<typeof axios.post>);

    const pending = retranslateFile(
      project.edir, project.fileName, 'ja', 'ko', createContext(),
    );
    await vi.waitFor(() => expect(resolveResponse).toBeTypeOf('function'));

    const newerEdit = `${project.currentContent}\n최신 수정`;
    fs.writeFileSync(project.filePath, newerEdit, 'utf-8');
    resolveResponse?.({
      data: {
        candidates: [{ content: { parts: [{ text: '--- 101-0 ---\n\\C[1]새 번역\n\n--- 101-1 ---\n새 세계' }] } }],
      },
    });

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toContain('파일이 변경');
    expect(fs.readFileSync(project.filePath, 'utf-8')).toBe(newerEdit);
  });
});

function createContext(): AppContext {
  return {
    llmAbort: false,
    settings: {
      ...defaultSettings,
      llmProvider: 'gemini',
      llmApiKey: 'test-key',
      llmModel: 'gemini-2.5-flash',
      llmTranslationUnit: 'chunk',
      llmChunkSize: 30,
      llmMaxRetries: 0,
      llmMaxApiRetries: 0,
      DoNotTransHangul: false,
    },
  } as AppContext;
}

function mockGeminiResponse(text: string): void {
  vi.spyOn(axios, 'post').mockResolvedValue({
    data: { candidates: [{ content: { parts: [{ text }] } }] },
  });
}

function makeProject() {
  const root = path.join(sandboxRoot, `${process.pid}-${Date.now()}-${sequence++}`);
  const edir = path.join(root, 'Extract');
  const backupDir = `${edir}_backup`;
  const fileName = 'Map001.txt';
  const filePath = path.join(edir, fileName);
  const originalContent = '--- 101-0 ---\n\\C[1]Hello\n\n--- 101-1 ---\nWorld';
  const currentContent = '--- 101-0 ---\n\\C[1]이전 번역\n\n--- 101-1 ---\n이전 세계';
  fs.mkdirSync(edir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, fileName), originalContent, 'utf-8');
  fs.writeFileSync(filePath, currentContent, 'utf-8');
  createdDirs.push(root);
  return { edir, fileName, filePath, originalContent, currentContent };
}
