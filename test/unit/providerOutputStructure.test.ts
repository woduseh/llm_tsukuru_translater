import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiTranslator } from '../../src/ts/libs/geminiTranslator';
import { createVertexTranslator } from '../../src/ts/libs/vertexTranslator';
import { createClaudeTranslator } from '../../src/ts/libs/claudeTranslator';
import { createOpenAiTranslator } from '../../src/ts/libs/openAiCompatibleTranslator';
import { stripMarkdownFences } from '../../src/ts/libs/translationPrompt';

const settings = {
  llmModel: 'fixture-model', llmApiKey: 'fixture-key', llmOpenAiApiKey: 'fixture-key',
  llmClaudeApiKey: 'fixture-key', llmMaxRetries: 1, llmMaxApiRetries: 0,
  llmTranslationUnit: 'file', DoNotTransHangul: false,
  llmVertexServiceAccountJson: JSON.stringify({ project_id: 'fixture', client_email: 'fixture@example.com', private_key: 'fixture' }),
};
const factories = {
  gemini: () => createGeminiTranslator(settings, 'en', 'ko'),
  vertex: () => createVertexTranslator(settings, 'en', 'ko', undefined, { accessTokenProvider: async () => 'fixture-token' }),
  openai: () => createOpenAiTranslator(settings, 'en', 'ko'),
  claude: () => createClaudeTranslator(settings, 'en', 'ko'),
};

afterEach(() => vi.restoreAllMocks());

describe.each(Object.entries(factories))('%s provider output structure', (_provider, factory) => {
  it.each([
    '--- 101 ---\nHello', '--- 101 ---\nHello\n', '--- 101 ---\nHello\n\n',
    '\nHello', '--- 101 ---\n  Hello \\V[1]  \n\n',
  ])('accepts exact output without retries: %j', async (source) => {
    const text = source.replace('Hello', '안녕');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {
      candidates: [{ content: { parts: [{ text }] } }],
      choices: [{ message: { content: text } }], content: [{ type: 'text', text }],
    } });
    const result = await factory().translateFileContent(source);
    expect(result.incomplete).toBe(false);
    expect(result.translatedContent).toBe(text);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

it('unwraps only complete outer fence lines, preserving all content inside', () => {
  const body = '\n  안녕 \\V[1]  \n\n';
  expect(stripMarkdownFences(`\u0060\u0060\u0060text\n${body}\n\u0060\u0060\u0060`)).toBe(body);
  expect(stripMarkdownFences('```text\r\n  안녕\r\n```\r\n')).toBe('  안녕');
  expect(stripMarkdownFences(body)).toBe(body);
  expect(stripMarkdownFences('```text\nnot a complete fence')).toBe('```text\nnot a complete fence');
});
