import { describe, expect, it } from 'vitest';
import { GeminiTranslator } from '../../src/ts/libs/geminiTranslator';
import {
  createTranslator,
  getLlmProviderDisplayName,
} from '../../src/ts/libs/translatorFactory';

describe('createTranslator', () => {
  it('returns the Gemini translator when llmProvider is gemini', () => {
    const translator = createTranslator({
      llmProvider: 'gemini',
      llmApiKey: 'test-key',
      llmModel: 'gemini-2.0-flash',
      llmCustomPrompt: '',
      llmChunkSize: 30,
      llmTranslationUnit: 'chunk',
      DoNotTransHangul: true,
    }, 'ja', 'ko');

    expect(translator).toBeInstanceOf(GeminiTranslator);
  });

  it('defaults to Gemini when llmProvider is not set', () => {
    const translator = createTranslator({
      llmApiKey: 'test-key',
      llmModel: 'gemini-2.0-flash',
      llmCustomPrompt: '',
      llmChunkSize: 30,
      llmTranslationUnit: 'chunk',
      DoNotTransHangul: true,
    }, 'ja', 'ko');

    expect(translator).toBeInstanceOf(GeminiTranslator);
  });
});

describe('getLlmProviderDisplayName', () => {
  it('returns stable provider labels for UI and errors', () => {
    expect(getLlmProviderDisplayName('gemini')).toBe('Gemini API');
    expect(getLlmProviderDisplayName('vertex')).toBe('Vertex AI');
    expect(getLlmProviderDisplayName(undefined)).toBe('Gemini API');
  });
});
