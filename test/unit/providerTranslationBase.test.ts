import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiTranslator } from '../../src/ts/libs/geminiTranslator';
import { ProviderTranslationBase } from '../../src/ts/libs/providerTranslationBase';

class StubTranslator extends ProviderTranslationBase {
  constructor(
    private readonly translate: (text: string) => Promise<string>,
    doNotTransHangul = false,
  ) {
    super({
      chunkSize: 2,
      translationUnit: 'chunk',
      doNotTransHangul,
      maxRetries: 0,
      maxApiRetries: 0,
    });
  }

  translateText(text: string): Promise<string> {
    return this.translate(text);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProviderTranslationBase terminal failures', () => {
  it('marks provider fallback as incomplete instead of an intentional skip', async () => {
    const translator = new StubTranslator(async () => {
      throw new Error('blocked by provider');
    });

    const result = await translator.translateFileContent('--- 1 ---\nHello');

    expect(result.translatedContent).toBe('--- 1 ---\nHello');
    expect(result.incomplete).toBe(true);
    expect(result.logEntry.errorBlocks).toBe(1);
    expect(result.logEntry.skippedBlocks).toBe(0);
  });

  it('skips only Hangul-containing blocks in a mixed source chunk', async () => {
    const calls: string[] = [];
    const translator = new StubTranslator(async (text) => {
      calls.push(text);
      return text.replace('Hello', '안녕');
    }, true);

    const result = await translator.translateFileContent(
      '--- 1 ---\n이미 번역됨\n--- 2 ---\nHello',
    );

    expect(calls).toEqual(['--- 2 ---\nHello']);
    expect(result.translatedContent).toBe('--- 1 ---\n이미 번역됨\n--- 2 ---\n안녕');
    expect(result.incomplete).toBe(false);
    expect(result.logEntry.skippedBlocks).toBe(1);
    expect(result.logEntry.translatedBlocks).toBe(1);
    expect(result.logEntry.errorBlocks).toBe(0);
  });
});

describe('Gemini error sanitization', () => {
  it('never logs the raw Axios error carrying the API key', async () => {
    const secret = 'gemini-secret-that-must-never-be-logged';
    const axiosError = Object.assign(new Error(`blocked by provider (${secret})`), {
      config: { headers: { 'x-goog-api-key': secret } },
    });
    vi.spyOn(axios, 'post').mockRejectedValue(axiosError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const translator = createGeminiTranslator({
      llmApiKey: secret,
      llmModel: 'gemini-2.5-flash',
      llmChunkSize: 1,
      llmTranslationUnit: 'chunk',
      llmMaxRetries: 0,
      llmMaxApiRetries: 0,
      DoNotTransHangul: false,
    }, 'ja', 'ko');

    const result = await translator.translateFileContent('--- 1 ---\nHello');
    const logged = consoleError.mock.calls.flat().map(String).join(' ');
    const recordedErrors = (result.logEntry.errors || []).join(' ');

    expect(result.incomplete).toBe(true);
    expect(logged).not.toContain(secret);
    expect(recordedErrors).not.toContain(secret);
    expect(recordedErrors).toContain('[REDACTED]');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
