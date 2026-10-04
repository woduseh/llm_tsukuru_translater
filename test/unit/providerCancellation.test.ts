import axios from 'axios';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiTranslator } from '../../src/ts/libs/geminiTranslator';
import { createVertexTranslator } from '../../src/ts/libs/vertexTranslator';
import { createClaudeTranslator } from '../../src/ts/libs/claudeTranslator';
import { createCustomOpenAiTranslator, createOpenAiTranslator } from '../../src/ts/libs/openAiCompatibleTranslator';
import { TranslationRequestScheduler } from '../../src/ts/libs/translationRequestScheduler';

const settings = { llmApiKey: 'fixture', llmOpenAiApiKey: 'fixture', llmClaudeApiKey: 'fixture',
  llmModel: 'fixture', llmMaxRetries: 2, llmMaxApiRetries: 2, llmTranslationUnit: 'file',
  llmVertexServiceAccountJson: JSON.stringify({ project_id: 'fixture', private_key: 'fixture', client_email: 'fixture@example.com' }),
};
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const factories = {
  gemini: () => createGeminiTranslator(settings, 'en', 'ko'),
  vertex: () => createVertexTranslator(settings, 'en', 'ko', undefined, { accessTokenProvider: async () => 'fixture' }),
  openai: () => createOpenAiTranslator(settings, 'en', 'ko'),
  claude: () => createClaudeTranslator(settings, 'en', 'ko'),
};

describe.each(Object.entries(factories))('%s request cancellation', (_name, factory) => {
  it('passes the run signal to HTTP and does not retry or return partial translations', async () => {
    const scheduler = new TranslationRequestScheduler();
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    const post = vi.spyOn(axios, 'post').mockImplementation((_url, _body, config) => {
      const signal = config?.signal as AbortSignal;
      expect(signal).toBe(scheduler.signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new axios.CanceledError('cancelled')), { once: true });
        requestStarted();
      });
    });
    const source = '--- 101 ---\nHello';
    const job = factory().translateFileContent(source, undefined, { scheduler });
    await started;
    scheduler.cancel();
    const result = await job;
    expect(result.status).toBe('aborted');
    expect(result).not.toHaveProperty('translatedContent');
    expect(result.logEntry.retries).toBe(0);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

it('observes external abort while the final HTTP request has no queued successor', async () => {
  vi.useFakeTimers();
  let abort = false;
  const scheduler = new TranslationRequestScheduler({ isAborted: () => abort });
  const started = scheduler.run(() => new Promise<void>((_resolve, reject) => {
    scheduler.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const failure = expect(started).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(1);
  abort = true;
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(scheduler.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a real local HTTP connection without waiting for a provider timeout', async () => {
  const scheduler = new TranslationRequestScheduler();
  let received!: () => void;
  const request = new Promise<void>(resolve => { received = resolve; });
  const server = http.createServer((_req, _res) => { received(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  try {
    const translator = createCustomOpenAiTranslator({ ...settings, llmCustomBaseUrl: `http://127.0.0.1:${address.port}/v1`, llmTimeout: 30 }, 'en', 'ko');
    const result = translator.translateFileContent('--- 101 ---\nHello', undefined, { scheduler });
    await request;
    scheduler.cancel();
    expect((await result).status).toBe('aborted');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
