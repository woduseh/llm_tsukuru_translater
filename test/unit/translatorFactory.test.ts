import { describe, expect, it } from 'vitest';
import { GeminiTranslator } from '../../src/ts/libs/geminiTranslator';
import { VertexTranslator } from '../../src/ts/libs/vertexTranslator';
import {
  buildTranslationCacheKey,
  createTranslator,
  getLlmReadinessError,
  getLlmProviderDisplayName,
} from '../../src/ts/libs/translatorFactory';

const validServiceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'vertex-project',
  private_key_id: 'private-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n',
  client_email: 'vertex@test-project.iam.gserviceaccount.com',
});

const baseGeminiSettings = {
  llmProvider: 'gemini',
  llmApiKey: 'test-key',
  llmModel: 'gemini-2.0-flash',
  llmCustomPrompt: '',
  llmChunkSize: 30,
  llmTranslationUnit: 'chunk',
  DoNotTransHangul: true,
};

const baseVertexSettings = {
  llmProvider: 'vertex',
  llmVertexServiceAccountJson: validServiceAccount,
  llmVertexLocation: 'global',
  llmModel: 'gemini-2.5-pro',
  llmCustomPrompt: '',
  llmChunkSize: 30,
  llmTranslationUnit: 'chunk',
  DoNotTransHangul: true,
};

describe('createTranslator', () => {
  it('returns the Gemini translator when llmProvider is gemini', () => {
    const translator = createTranslator(baseGeminiSettings, 'ja', 'ko');

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

  it('returns the Vertex translator when llmProvider is vertex', () => {
    const translator = createTranslator(baseVertexSettings, 'ja', 'ko');

    expect(translator).toBeInstanceOf(VertexTranslator);
  });
});

describe('getLlmProviderDisplayName', () => {
  it('returns stable provider labels for UI and errors', () => {
    expect(getLlmProviderDisplayName('gemini')).toBe('Gemini API');
    expect(getLlmProviderDisplayName('vertex')).toBe('Vertex AI');
    expect(getLlmProviderDisplayName(undefined)).toBe('Gemini API');
  });
});

describe('getLlmReadinessError', () => {
  it('returns the Gemini-specific missing-key error', () => {
    expect(getLlmReadinessError({
      ...baseGeminiSettings,
      llmApiKey: '',
    } as never)).toBe('Gemini API 키가 설정되지 않았습니다.');
  });

  it('returns the Vertex-specific missing-service-account error', () => {
    expect(getLlmReadinessError({
      ...baseVertexSettings,
      llmVertexServiceAccountJson: '',
    } as never)).toBe('Vertex AI 서비스 계정 JSON이 설정되지 않았습니다.');
  });
});

describe('buildTranslationCacheKey', () => {
  it('includes provider identity to avoid cross-provider cache collisions', () => {
    expect(buildTranslationCacheKey('vertex', 'abc123', 'gemini-2.5-pro', 'ko')).toBe(
      'vertex_abc123_gemini-2.5-pro_ko',
    );
    expect(buildTranslationCacheKey('gemini', 'abc123', 'gemini-2.0-flash', 'ko')).toBe(
      'gemini_abc123_gemini-2.0-flash_ko',
    );
  });
});
