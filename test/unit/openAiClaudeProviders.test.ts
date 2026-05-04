import { describe, expect, it, vi } from 'vitest';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import {
  buildChatCompletionsUrl,
  createCustomOpenAiTranslator,
  createOpenAiTranslator,
  OPENAI_BASE_URL,
} from '../../src/ts/libs/openAiCompatibleTranslator';
import {
  ANTHROPIC_VERSION,
  CLAUDE_MESSAGES_URL,
  createClaudeTranslator,
} from '../../src/ts/libs/claudeTranslator';

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultSettings,
    DoNotTransHangul: false,
    llmOpenAiApiKey: 'openai-secret',
    llmCustomApiKey: 'custom-secret',
    llmCustomBaseUrl: 'http://localhost:1234/v1',
    llmClaudeApiKey: 'claude-secret',
    llmModel: 'test-model',
    llmMaxRetries: 0,
    llmMaxApiRetries: 0,
    llmTimeout: 30,
    llmTranslationUnit: 'file',
    llmMaxTokens: 2048,
    ...overrides,
  };
}

describe('OpenAI-compatible providers', () => {
  it('formats official OpenAI Chat Completions requests and parses success', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { choices: [{ message: { content: '번역문' } }] },
    });
    const translator = createOpenAiTranslator(createSettings({ llmModel: 'gpt-4o-mini' }), 'ja', 'ko', undefined, {
      httpClient: { post },
    });

    await expect(translator.translateText('原文')).resolves.toBe('번역문');
    expect(post).toHaveBeenCalledWith(`${OPENAI_BASE_URL}/chat/completions`, expect.objectContaining({
      model: 'gpt-4o-mini',
      messages: [
        expect.objectContaining({ role: 'system', content: expect.stringContaining('RPG game localization') }),
        expect.objectContaining({ role: 'user', content: '<Source_Text>\n原文\n</Source_Text>' }),
      ],
    }), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer openai-secret' }),
      timeout: 30000,
    }));
  });

  it('supports custom base URLs and optional API keys', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { choices: [{ message: { content: '로컬 번역' } }] },
    });
    const translator = createCustomOpenAiTranslator(createSettings({
      llmCustomBaseUrl: 'http://127.0.0.1:8080/v1/',
      llmCustomApiKey: '',
      llmModel: 'local-model',
    }), 'ja', 'ko', undefined, { httpClient: { post } });

    await expect(translator.translateText('原文')).resolves.toBe('로컬 번역');
    expect(post).toHaveBeenCalledWith('http://127.0.0.1:8080/v1/chat/completions', expect.any(Object), expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(buildChatCompletionsUrl('http://127.0.0.1:8080/v1/chat/completions')).toBe('http://127.0.0.1:8080/v1/chat/completions');
  });

  it('normalizes auth, rate limit, timeout, and malformed response errors without leaking secrets', async () => {
    const authPost = vi.fn().mockRejectedValue({
      response: { status: 401, data: { error: { message: 'bad openai-secret' } } },
    });
    const authTranslator = createOpenAiTranslator(createSettings(), 'ja', 'ko', undefined, { httpClient: { post: authPost } });
    await expect(authTranslator.translateText('x')).rejects.toThrow(/authentication failed: bad \[REDACTED\]/);

    const ratePost = vi.fn().mockRejectedValue({
      response: { status: 429, data: { error: { message: 'slow down' } } },
    });
    const rateTranslator = createOpenAiTranslator(createSettings(), 'ja', 'ko', undefined, { httpClient: { post: ratePost } });
    await expect(rateTranslator.translateText('x')).rejects.toThrow(/rate limit \(429\): slow down/);

    const timeoutPost = vi.fn().mockRejectedValue(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));
    const timeoutTranslator = createOpenAiTranslator(createSettings(), 'ja', 'ko', undefined, { httpClient: { post: timeoutPost } });
    await expect(timeoutTranslator.translateText('x')).rejects.toThrow(/timeout/);

    const malformedPost = vi.fn().mockResolvedValue({ data: { choices: [] } });
    const malformedTranslator = createOpenAiTranslator(createSettings(), 'ja', 'ko', undefined, { httpClient: { post: malformedPost } });
    await expect(malformedTranslator.translateText('x')).rejects.toThrow(/malformed response/);
  });
});

describe('Claude provider', () => {
  it('formats Anthropic Messages API requests and parses success', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { content: [{ type: 'text', text: '클로드 번역' }] },
    });
    const translator = createClaudeTranslator(createSettings({
      llmModel: 'claude-3-5-haiku-latest',
      llmMaxTokens: 1234,
    }), 'ja', 'ko', undefined, { httpClient: { post } });

    await expect(translator.translateText('原文')).resolves.toBe('클로드 번역');
    expect(post).toHaveBeenCalledWith(CLAUDE_MESSAGES_URL, expect.objectContaining({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1234,
      system: expect.stringContaining('RPG game localization'),
      messages: [{ role: 'user', content: '<Source_Text>\n原文\n</Source_Text>' }],
    }), expect.objectContaining({
      headers: expect.objectContaining({
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': 'claude-secret',
      }),
      timeout: 30000,
    }));
  });

  it('normalizes Claude auth and malformed response errors without leaking secrets', async () => {
    const authPost = vi.fn().mockRejectedValue({
      response: { status: 403, data: { error: { message: 'bad claude-secret' } } },
    });
    const authTranslator = createClaudeTranslator(createSettings(), 'ja', 'ko', undefined, { httpClient: { post: authPost } });
    await expect(authTranslator.translateText('x')).rejects.toThrow(/authentication failed: bad \[REDACTED\]/);

    const malformedPost = vi.fn().mockResolvedValue({ data: { content: [{ type: 'image' }] } });
    const malformedTranslator = createClaudeTranslator(createSettings(), 'ja', 'ko', undefined, { httpClient: { post: malformedPost } });
    await expect(malformedTranslator.translateText('x')).rejects.toThrow(/malformed response/);
  });
});
