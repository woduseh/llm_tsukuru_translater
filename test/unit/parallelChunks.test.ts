import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { ProviderTranslationBase, type ProviderTranslationConfig } from '../../src/ts/libs/providerTranslationBase';
import { createGeminiTranslator } from '../../src/ts/libs/geminiTranslator';

class StubTranslator extends ProviderTranslationBase {
  constructor(private translate: (text: string) => Promise<string>, overrides: Partial<ProviderTranslationConfig> = {}) {
    super({ chunkSize: 1, translationUnit: 'chunk', doNotTransHangul: false, maxRetries: 0, maxApiRetries: 0, requestConcurrency: 2, ...overrides });
  }
  translateText(text: string) { return this.translate(text); }
}

const source = '--- 1 ---\n\\C[1]One\n\n--- 2 ---\nTwo\n--- 3 ---\nThree\n';
const translated = (text: string) => text.replace('One', '하나').replace('Two', '둘').replace('Three', '셋');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('parallel translation chunks', () => {
  it('assembles out-of-order responses in original order with stable validation indices and monotonic progress', async () => {
    vi.useFakeTimers();
    const completed: number[] = [];
    const progress: number[] = [];
    let active = 0;
    let maximum = 0;
    const translator = new StubTranslator(async (text) => {
      maximum = Math.max(maximum, ++active);
      const id = Number(text.match(/--- (\d) ---/)![1]);
      await sleep(id === 1 ? 100 : 10);
      active--;
      completed.push(id);
      return translated(text);
    });
    const job = translator.translateFileContent(source, (current) => progress.push(current));
    await vi.runAllTimersAsync();
    const result = await job;
    expect(completed).toEqual([2, 3, 1]);
    expect(maximum).toBe(2);
    expect(result.translatedContent).toBe(translated(source));
    expect(result.validation.map((v) => v.index)).toEqual([0, 1, 2]);
    expect(result.validation.every((v) => v.lineCountMatch && v.separatorMatch)).toBe(true);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(3);
    expect(result.logEntry).toMatchObject({ translatedBlocks: 3, errorBlocks: 0, retries: 0 });
  });

  it('retries only an invalid chunk and never resubmits successful or skipped chunks', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let invalidAttempts = 0;
    const translator = new StubTranslator(async (text) => {
      calls.push(text);
      await sleep(10);
      if (text.includes('Two') && invalidAttempts++ === 0) return 'invalid\nextra\nlines';
      return translated(text);
    }, { doNotTransHangul: true, maxRetries: 1 });
    const content = source.replace('Three', '이미 번역됨');
    const job = translator.translateFileContent(content);
    await vi.runAllTimersAsync();
    const result = await job;
    expect(calls.filter((text) => text.includes('One'))).toHaveLength(1);
    expect(calls.filter((text) => text.includes('Two'))).toHaveLength(2);
    expect(calls.some((text) => text.includes('이미 번역됨'))).toBe(false);
    expect(result.translatedContent).toBe(translated(content));
    expect(result.logEntry).toMatchObject({ translatedBlocks: 2, skippedBlocks: 1, retries: 1 });
    expect(result.incomplete).toBe(false);
  });

  it('cancels pending chunks and drains active requests before reporting abortion', async () => {
    vi.useFakeTimers();
    let aborted = false;
    let active = 0;
    const calls: string[] = [];
    const translator = new StubTranslator(async (text) => {
      calls.push(text);
      active++;
      await sleep(100);
      active--;
      return translated(text);
    }, { isAborted: () => aborted });
    let settled = false;
    const job = translator.translateFileContent(source).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(1);
    aborted = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    await vi.runAllTimersAsync();
    expect((await job).aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(active).toBe(0);
  });

  it('drains active requests if a progress callback throws', async () => {
    vi.useFakeTimers();
    let active = 0;
    const translator = new StubTranslator(async (text) => {
      active++;
      await sleep(text.includes('One') ? 10 : 100);
      active--;
      return translated(text);
    });
    const job = translator.translateFileContent(source, (current) => { if (current > 0) throw new Error('progress failed'); });
    const failed = expect(job).rejects.toThrow('progress failed');
    await vi.runAllTimersAsync();
    await failed;
    expect(active).toBe(0);
  });

  it('honors shared 429 RetryInfo without leaking secrets and respects the API retry budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attempts: number[] = [];
    const secret = 'private-key';
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      attempts.push(Date.now());
      throw Object.assign(new Error('request failed'), {
        config: { headers: { 'x-goog-api-key': secret } },
        response: { status: 429, data: { error: { message: secret, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '10s' }] } } },
      });
    });
    const translator = createGeminiTranslator({ llmApiKey: secret, llmModel: 'gemini-flash-latest', llmTranslationUnit: 'chunk', llmChunkSize: 1, llmParallelWorkers: 1, llmMaxRetries: 3, llmMaxApiRetries: 1 }, 'ja', 'ko');
    const job = translator.translateFileContent('--- 1 ---\nOne');
    await vi.runAllTimersAsync();
    const result = await job;
    expect(attempts).toEqual([0, 10000]);
    expect(result.incomplete).toBe(true);
    expect(result.logEntry.errorBlocks).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('Gemini latest request compatibility', () => {
  it.each(['gemini-flash-latest', 'models/gemini-flash-latest', 'gemini-3.8-flash'])('ends %s requests with source text in a user turn', async (model) => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: translated(source) }] } }] } });
    await createGeminiTranslator({ llmApiKey: 'test', llmModel: model }, 'ja', 'ko').translateText(source);
    const payload = post.mock.calls[0][1] as { contents: { role: string; parts: { text: string }[] }[] };
    expect(payload.contents).toHaveLength(1);
    expect(payload.contents[0].role).toBe('user');
    expect(payload.contents[0].parts[0].text).toContain(source);
  });
});
