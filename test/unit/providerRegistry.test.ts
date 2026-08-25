import { describe, expect, it } from 'vitest';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import { GeminiTranslator } from '../../src/ts/libs/geminiTranslator';
import { VertexTranslator } from '../../src/ts/libs/vertexTranslator';
import { OpenAiCompatibleTranslator } from '../../src/ts/libs/openAiCompatibleTranslator';
import { ClaudeTranslator } from '../../src/ts/libs/claudeTranslator';
import {
  buildProviderCacheFingerprint,
  buildProviderConfigFingerprint,
  createProviderTranslator,
  getAllProviderSecretSettingKeys,
  getProviderRegistryEntry,
  LLM_CACHE_KEY_PREFIX,
  listProviderRegistryEntries,
  validateProviderReadiness,
} from '../../src/ts/libs/providerRegistry';

const validServiceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'vertex-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n',
  client_email: 'vertex@test-project.iam.gserviceaccount.com',
});

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultSettings,
    llmProvider: 'gemini',
    llmApiKey: 'gemini-secret',
    llmOpenAiApiKey: 'openai-secret',
    llmCustomApiKey: 'custom-secret',
    llmCustomBaseUrl: 'http://localhost:1234/v1',
    llmClaudeApiKey: 'claude-secret',
    llmModel: 'gemini-2.5-flash',
    llmMaxTokens: 4096,
    llmVertexLocation: 'global',
    llmVertexServiceAccountJson: validServiceAccountJson,
    ...overrides,
  };
}

describe('provider registry', () => {
  it('registers provider metadata without placeholder providers', () => {
    const entries = listProviderRegistryEntries();

    expect(entries.map((entry) => entry.id).sort()).toEqual(['claude', 'custom-openai', 'gemini', 'openai', 'vertex']);
    expect(getProviderRegistryEntry('gemini')).toMatchObject({
      displayName: 'Gemini API',
      credentialSettingKeys: ['llmApiKey'],
      secretSettingKeys: ['llmApiKey'],
      defaultModel: 'gemini-2.5-flash',
      concurrencyCap: 1,
    });
    expect(defaultSettings.llmModel).toBe(getProviderRegistryEntry('gemini').defaultModel);
    expect(getProviderRegistryEntry('vertex')).toMatchObject({
      displayName: 'Vertex AI',
      credentialSettingKeys: ['llmVertexServiceAccountJson', 'llmVertexLocation'],
      secretSettingKeys: ['llmVertexServiceAccountJson'],
      defaultModel: 'gemini-2.5-pro',
      concurrencyCap: 1,
    });
    expect(getProviderRegistryEntry('openai')).toMatchObject({
      displayName: 'OpenAI',
      credentialSettingKeys: ['llmOpenAiApiKey'],
      secretSettingKeys: ['llmOpenAiApiKey'],
      defaultModel: 'gpt-4o-mini',
      concurrencyCap: 2,
    });
    expect(getProviderRegistryEntry('custom-openai')).toMatchObject({
      displayName: 'OpenAI 호환 API',
      credentialSettingKeys: ['llmCustomBaseUrl', 'llmCustomApiKey'],
      secretSettingKeys: ['llmCustomApiKey'],
      concurrencyCap: 2,
    });
    expect(getProviderRegistryEntry('claude')).toMatchObject({
      displayName: 'Claude',
      credentialSettingKeys: ['llmClaudeApiKey'],
      secretSettingKeys: ['llmClaudeApiKey'],
      concurrencyCap: 2,
    });
  });

  it('centralizes provider secret keys for renderer sanitization', () => {
    expect(getAllProviderSecretSettingKeys()).toEqual([
      'llmApiKey',
      'llmVertexServiceAccountJson',
      'llmOpenAiApiKey',
      'llmCustomApiKey',
      'llmClaudeApiKey',
    ]);
  });

  it('validates readiness through provider-specific validators', () => {
    expect(validateProviderReadiness(createSettings({ llmProvider: 'gemini' })).llmReady).toBe(true);
    expect(validateProviderReadiness(createSettings({ llmProvider: 'gemini', llmApiKey: '' })).llmValidationErrors).toContain('Gemini API key is required.');
    expect(validateProviderReadiness(createSettings({ llmProvider: 'vertex', llmVertexServiceAccountJson: '' })).llmValidationErrors).toContain('Vertex service account JSON is required.');
    expect(validateProviderReadiness(createSettings({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' })).llmReady).toBe(true);
    expect(validateProviderReadiness(createSettings({ llmProvider: 'openai', llmOpenAiApiKey: '' })).llmValidationErrors).toContain('OpenAI API key is required.');
    expect(validateProviderReadiness(createSettings({ llmProvider: 'custom-openai', llmModel: 'local' })).llmReady).toBe(true);
    expect(validateProviderReadiness(createSettings({ llmProvider: 'custom-openai', llmCustomBaseUrl: '' })).llmValidationErrors).toContain('OpenAI-compatible base URL is required.');
    expect(validateProviderReadiness(createSettings({ llmProvider: 'claude', llmModel: 'claude-haiku-4-5-20251001' })).llmReady).toBe(true);
    expect(validateProviderReadiness(createSettings({ llmProvider: 'claude', llmClaudeApiKey: '' })).llmValidationErrors).toContain('Claude API key is required.');
  });

  it('creates provider translators through registry factories', () => {
    expect(createProviderTranslator({
      settings: createSettings({ llmProvider: 'gemini' }),
      sourceLang: 'ja',
      targetLang: 'ko',
    })).toBeInstanceOf(GeminiTranslator);

    expect(createProviderTranslator({
      settings: createSettings({ llmProvider: 'vertex' }),
      sourceLang: 'ja',
      targetLang: 'ko',
    })).toBeInstanceOf(VertexTranslator);

    expect(createProviderTranslator({
      settings: createSettings({ llmProvider: 'openai', llmModel: 'gpt-4o-mini' }),
      sourceLang: 'ja',
      targetLang: 'ko',
    })).toBeInstanceOf(OpenAiCompatibleTranslator);

    expect(createProviderTranslator({
      settings: createSettings({ llmProvider: 'custom-openai', llmModel: 'local' }),
      sourceLang: 'ja',
      targetLang: 'ko',
    })).toBeInstanceOf(OpenAiCompatibleTranslator);

    expect(createProviderTranslator({
      settings: createSettings({ llmProvider: 'claude', llmModel: 'claude-haiku-4-5-20251001' }),
      sourceLang: 'ja',
      targetLang: 'ko',
    })).toBeInstanceOf(ClaudeTranslator);
  });

  it('uses versioned deterministic cache fingerprints and invalidates legacy keys', () => {
    const geminiKey = buildProviderCacheFingerprint('gemini', {
      hash: 'abc123',
      model: 'gemini-2.5-flash',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({ llmProvider: 'gemini' }),
    });
    const sameGeminiKey = buildProviderCacheFingerprint('gemini', {
      hash: 'abc123',
      model: 'gemini-2.5-flash',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({ llmProvider: 'gemini' }),
    });
    const vertexKey = buildProviderCacheFingerprint('vertex', {
      hash: 'abc123',
      model: 'gemini-2.5-pro',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({ llmProvider: 'vertex' }),
    });

    expect(geminiKey).toBe(sameGeminiKey);
    expect(geminiKey).toMatch(new RegExp(`^${LLM_CACHE_KEY_PREFIX}_gemini_abc123_[a-f0-9]{64}$`));
    expect(vertexKey).toMatch(new RegExp(`^${LLM_CACHE_KEY_PREFIX}_vertex_abc123_[a-f0-9]{64}$`));
    expect(geminiKey).not.toBe('gemini_abc123_gemini-2.5-flash_ko');
  });

  it('keeps fingerprints deterministic without including or depending on secrets', () => {
    const openAiKey = buildProviderCacheFingerprint('openai', {
      hash: 'abc123',
      model: 'gpt-4o-mini',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({
        llmProvider: 'openai',
        llmOpenAiApiKey: 'openai-secret-that-must-not-appear',
      }),
    });
    const claudeKey = buildProviderCacheFingerprint('claude', {
      hash: 'abc123',
      model: 'claude-haiku-4-5-20251001',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({
        llmProvider: 'claude',
        llmClaudeApiKey: 'claude-secret-that-must-not-appear',
      }),
    });
    const openAiKeyWithRotatedSecret = buildProviderCacheFingerprint('openai', {
      hash: 'abc123',
      model: 'gpt-4o-mini',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({
        llmProvider: 'openai',
        llmOpenAiApiKey: 'rotated-secret-that-must-not-appear',
      }),
    });

    expect(openAiKey).toBe(openAiKeyWithRotatedSecret);
    expect(openAiKey).not.toContain('openai-secret-that-must-not-appear');
    expect(claudeKey).not.toContain('claude-secret-that-must-not-appear');
    expect(openAiKey).not.toEqual(claudeKey);
  });

  it('separates cache fingerprints by custom base URL without including secrets', () => {
    const first = buildProviderCacheFingerprint('custom-openai', {
      hash: 'abc123',
      model: 'local',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({
        llmProvider: 'custom-openai',
        llmModel: 'local',
        llmCustomBaseUrl: 'http://localhost:1234/v1',
        llmCustomApiKey: 'secret-that-must-not-appear',
      }),
    });
    const second = buildProviderCacheFingerprint('custom-openai', {
      hash: 'abc123',
      model: 'local',
      sourceLang: 'ja',
      targetLang: 'ko',
      settings: createSettings({
        llmProvider: 'custom-openai',
        llmModel: 'local',
        llmCustomBaseUrl: 'http://localhost:8080/v1',
        llmCustomApiKey: 'secret-that-must-not-appear',
      }),
    });

    expect(first).not.toEqual(second);
    expect(first).not.toContain('secret-that-must-not-appear');
    expect(second).not.toContain('secret-that-must-not-appear');
  });

  it('separates fingerprints for every translation-affecting setting', () => {
    const base = createSettings({ llmProvider: 'vertex', llmCustomPrompt: 'voice A' });
    const fingerprint = (overrides: Record<string, unknown> = {}, sourceLang = 'ja') =>
      buildProviderConfigFingerprint('vertex', {
        model: 'gemini-2.5-pro',
        sourceLang,
        targetLang: 'ko',
        settings: { ...base, ...overrides },
      });

    expect(fingerprint({ llmCustomPrompt: 'voice B' })).not.toBe(fingerprint());
    expect(fingerprint({ llmVertexLocation: 'asia-northeast3' })).not.toBe(fingerprint());
    expect(fingerprint({ llmTranslationUnit: 'file' })).not.toBe(fingerprint());
    expect(fingerprint({ llmChunkSize: 5 })).not.toBe(fingerprint());
    expect(fingerprint({ DoNotTransHangul: false })).not.toBe(fingerprint());
    expect(fingerprint({}, 'en')).not.toBe(fingerprint());
    expect(fingerprint()).not.toContain('voice A');
    expect(fingerprint()).not.toContain(validServiceAccountJson);
  });
});
