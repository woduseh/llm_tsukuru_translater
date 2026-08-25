import crypto from 'crypto';
import {
  type AppSettings,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_VERTEX_LOCATION,
  type LlmProvider,
} from '../../types/settings';
import {
  LLM_PROVIDER_METADATA,
  LLM_PROVIDER_SECRET_SETTING_KEYS,
  type LlmProviderMetadataContract,
  type LlmProviderSecretSettingKey,
  type LlmProviderSettingKey,
} from '../../types/llmProviderContract';
import {
  createGeminiTranslator,
  GeminiTranslator,
} from './geminiTranslator';
import {
  createVertexTranslator,
  VertexTranslator,
} from './vertexTranslator';
import {
  createCustomOpenAiTranslator,
  createOpenAiTranslator,
  OpenAiCompatibleTranslator,
} from './openAiCompatibleTranslator';
import {
  ClaudeTranslator,
  createClaudeTranslator,
} from './claudeTranslator';
import { parseVertexServiceAccountJson } from './vertexCredentials';
import type { Translator } from './translatorFactory';

export interface ProviderReadinessValidation {
  llmProvider: LlmProvider;
  llmVertexLocation: string;
  llmReady: boolean;
  llmHasApiKey: boolean;
  llmHasVertexServiceAccountJson: boolean;
  llmValidationErrors: string[];
}

export interface ProviderTranslatorFactoryArgs {
  settings: Partial<AppSettings> & Record<string, unknown>;
  sourceLang: string;
  targetLang?: string;
  isAborted?: () => boolean;
}

export interface ProviderConfigFingerprintArgs {
  model: string;
  sourceLang: string;
  targetLang: string;
  settings: Partial<AppSettings> & Record<string, unknown>;
}

export interface ProviderCacheFingerprintArgs extends ProviderConfigFingerprintArgs {
  hash: string;
}

export interface LlmProviderRegistryEntry extends LlmProviderMetadataContract {
  configHint: string;
  missingConfigMessage: string;
  readinessValidator(settings: Partial<AppSettings> & Record<string, unknown>): ProviderReadinessValidation;
  cacheFingerprint(args: ProviderCacheFingerprintArgs): string;
  translatorFactory(args: ProviderTranslatorFactoryArgs): Translator;
  concurrencyCap: number;
}

type SettingsLike = Partial<AppSettings> & Record<string, unknown>;

export const LLM_FINGERPRINT_SCHEMA_VERSION = 2;
export const LLM_CACHE_KEY_PREFIX = `llm-cache-v${LLM_FINGERPRINT_SCHEMA_VERSION}`;
const LLM_CONFIG_KEY_PREFIX = `llm-config-v${LLM_FINGERPRINT_SCHEMA_VERSION}`;
const secretSettingKeys = new Set<string>(LLM_PROVIDER_SECRET_SETTING_KEYS);

function hasConfiguredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getVertexLocation(value: unknown): string {
  return hasConfiguredText(value) ? value.trim() : DEFAULT_LLM_VERTEX_LOCATION;
}

function createBaseReadiness(settings: SettingsLike, provider: LlmProvider): ProviderReadinessValidation {
  return {
    llmProvider: provider,
    llmVertexLocation: getVertexLocation(settings.llmVertexLocation),
    llmReady: false,
    llmHasApiKey: hasConfiguredText(settings.llmApiKey),
    llmHasVertexServiceAccountJson: hasConfiguredText(settings.llmVertexServiceAccountJson),
    llmValidationErrors: [],
  };
}

function requireModel(settings: SettingsLike, validation: ProviderReadinessValidation): void {
  if (!hasConfiguredText(settings.llmModel)) {
    validation.llmValidationErrors.push('LLM model is required.');
  }
}

function completeReadiness(validation: ProviderReadinessValidation): ProviderReadinessValidation {
  return {
    ...validation,
    llmReady: validation.llmValidationErrors.length === 0,
  };
}

function normalizeFingerprintValue(
  key: LlmProviderSettingKey,
  provider: LlmProvider,
  args: ProviderConfigFingerprintArgs,
): unknown {
  if (key === 'llmProvider') return provider;
  if (key === 'llmModel') return args.model.trim();
  if (key === 'llmSourceLang') return args.sourceLang.trim();
  if (key === 'llmTargetLang') return args.targetLang.trim();

  const value = args.settings[key];
  if (key === 'llmCustomPrompt') {
    return typeof value === 'string' ? value.trim() : '';
  }
  if (key === 'llmCustomBaseUrl') {
    return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  }
  if (key === 'llmVertexLocation') {
    return getVertexLocation(value);
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function buildProviderConfigDigest(provider: LlmProvider, args: ProviderConfigFingerprintArgs): string {
  const metadata = LLM_PROVIDER_METADATA[provider];
  const configEntries = metadata.cacheKeyParts
    .filter((key) => !secretSettingKeys.has(key))
    .map((key) => [key, normalizeFingerprintValue(key, provider, args)] as const);
  return crypto.createHash('sha256').update(JSON.stringify(configEntries), 'utf8').digest('hex');
}

function versionedCacheFingerprint(provider: LlmProvider, args: ProviderCacheFingerprintArgs): string {
  return `${LLM_CACHE_KEY_PREFIX}_${provider}_${args.hash}_${buildProviderConfigDigest(provider, args)}`;
}

const providerRegistry = {
  gemini: {
    ...LLM_PROVIDER_METADATA.gemini,
    configHint: 'Gemini API 키를 입력하면 번역, 재번역, JSON 검증 복구에 그대로 사용됩니다.',
    missingConfigMessage: 'Gemini API 설정이 완료되지 않았습니다. 메인 설정에서 API 키와 모델을 확인해주세요.',
    concurrencyCap: LLM_PROVIDER_METADATA.gemini.maxRecommendedConcurrency,
    readinessValidator(settings: SettingsLike): ProviderReadinessValidation {
      const validation = createBaseReadiness(settings, 'gemini');
      requireModel(settings, validation);
      if (!validation.llmHasApiKey) {
        validation.llmValidationErrors.push('Gemini API key is required.');
      }
      return completeReadiness(validation);
    },
    cacheFingerprint(args: ProviderCacheFingerprintArgs): string {
      return versionedCacheFingerprint('gemini', args);
    },
    translatorFactory(args: ProviderTranslatorFactoryArgs): Translator {
      return createGeminiTranslator(args.settings, args.sourceLang, args.targetLang, args.isAborted);
    },
  },
  vertex: {
    ...LLM_PROVIDER_METADATA.vertex,
    configHint: 'Google Cloud 서비스 계정 JSON 전체를 붙여넣고 Vertex 위치는 기본값 global을 사용하세요.',
    missingConfigMessage: 'Vertex AI 설정이 완료되지 않았습니다. 메인 설정에서 서비스 계정 JSON, 위치, 모델을 확인해주세요.',
    concurrencyCap: LLM_PROVIDER_METADATA.vertex.maxRecommendedConcurrency,
    readinessValidator(settings: SettingsLike): ProviderReadinessValidation {
      const validation = createBaseReadiness(settings, 'vertex');
      requireModel(settings, validation);
      try {
        parseVertexServiceAccountJson(String(settings.llmVertexServiceAccountJson || ''));
      } catch (error) {
        validation.llmValidationErrors.push((error as Error).message);
      }
      return completeReadiness(validation);
    },
    cacheFingerprint(args: ProviderCacheFingerprintArgs): string {
      return versionedCacheFingerprint('vertex', args);
    },
    translatorFactory(args: ProviderTranslatorFactoryArgs): Translator {
      return createVertexTranslator(args.settings, args.sourceLang, args.targetLang, args.isAborted);
    },
  },
  openai: {
    ...LLM_PROVIDER_METADATA.openai,
    configHint: 'OpenAI API 키와 모델을 입력하세요. 공식 Chat Completions API를 사용합니다.',
    missingConfigMessage: 'OpenAI 설정이 완료되지 않았습니다. API 키와 모델을 확인해주세요.',
    concurrencyCap: LLM_PROVIDER_METADATA.openai.maxRecommendedConcurrency,
    readinessValidator(settings: SettingsLike): ProviderReadinessValidation {
      const validation = createBaseReadiness(settings, 'openai');
      requireModel(settings, validation);
      if (!hasConfiguredText(settings.llmOpenAiApiKey)) {
        validation.llmValidationErrors.push('OpenAI API key is required.');
      }
      return completeReadiness(validation);
    },
    cacheFingerprint(args: ProviderCacheFingerprintArgs): string {
      return versionedCacheFingerprint('openai', args);
    },
    translatorFactory(args: ProviderTranslatorFactoryArgs): Translator {
      return createOpenAiTranslator(args.settings, args.sourceLang, args.targetLang, args.isAborted);
    },
  },
  'custom-openai': {
    ...LLM_PROVIDER_METADATA['custom-openai'],
    configHint: 'LM Studio, LocalAI, vLLM 등 OpenAI Chat Completions 호환 /v1 Base URL을 입력하세요. API 키는 선택입니다.',
    missingConfigMessage: 'OpenAI 호환 API 설정이 완료되지 않았습니다. Base URL과 모델을 확인해주세요.',
    concurrencyCap: LLM_PROVIDER_METADATA['custom-openai'].maxRecommendedConcurrency,
    readinessValidator(settings: SettingsLike): ProviderReadinessValidation {
      const validation = createBaseReadiness(settings, 'custom-openai');
      requireModel(settings, validation);
      if (!hasConfiguredText(settings.llmCustomBaseUrl)) {
        validation.llmValidationErrors.push('OpenAI-compatible base URL is required.');
      } else {
        try {
          const parsed = new URL(String(settings.llmCustomBaseUrl));
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            validation.llmValidationErrors.push('OpenAI-compatible base URL must use http or https.');
          }
        } catch {
          validation.llmValidationErrors.push('OpenAI-compatible base URL is invalid.');
        }
      }
      return completeReadiness(validation);
    },
    cacheFingerprint(args: ProviderCacheFingerprintArgs): string {
      return versionedCacheFingerprint('custom-openai', args);
    },
    translatorFactory(args: ProviderTranslatorFactoryArgs): Translator {
      return createCustomOpenAiTranslator(args.settings, args.sourceLang, args.targetLang, args.isAborted);
    },
  },
  claude: {
    ...LLM_PROVIDER_METADATA.claude,
    configHint: 'Claude API 키, 모델, 최대 토큰 수를 입력하세요. Anthropic Messages API를 사용합니다.',
    missingConfigMessage: 'Claude 설정이 완료되지 않았습니다. API 키, 모델, 최대 토큰 수를 확인해주세요.',
    concurrencyCap: LLM_PROVIDER_METADATA.claude.maxRecommendedConcurrency,
    readinessValidator(settings: SettingsLike): ProviderReadinessValidation {
      const validation = createBaseReadiness(settings, 'claude');
      requireModel(settings, validation);
      if (!hasConfiguredText(settings.llmClaudeApiKey)) {
        validation.llmValidationErrors.push('Claude API key is required.');
      }
      if (typeof settings.llmMaxTokens !== 'number' || !Number.isInteger(settings.llmMaxTokens) || settings.llmMaxTokens < 1) {
        validation.llmValidationErrors.push('Claude max tokens must be a positive integer.');
      }
      return completeReadiness(validation);
    },
    cacheFingerprint(args: ProviderCacheFingerprintArgs): string {
      return versionedCacheFingerprint('claude', args);
    },
    translatorFactory(args: ProviderTranslatorFactoryArgs): Translator {
      return createClaudeTranslator(args.settings, args.sourceLang, args.targetLang, args.isAborted);
    },
  },
} as const satisfies Record<LlmProvider, LlmProviderRegistryEntry>;

export function normalizeLlmProvider(value: unknown): LlmProvider {
  return isKnownLlmProvider(value) ? value : DEFAULT_LLM_PROVIDER;
}

export function isKnownLlmProvider(value: unknown): value is LlmProvider {
  return value === 'gemini'
    || value === 'vertex'
    || value === 'openai'
    || value === 'custom-openai'
    || value === 'claude';
}

export function getProviderRegistryEntry(provider: unknown): LlmProviderRegistryEntry {
  return providerRegistry[normalizeLlmProvider(provider)];
}

export function listProviderRegistryEntries(): readonly LlmProviderRegistryEntry[] {
  return [
    providerRegistry.gemini,
    providerRegistry.vertex,
    providerRegistry.openai,
    providerRegistry['custom-openai'],
    providerRegistry.claude,
  ];
}

export function getLlmProviderDisplayName(provider: unknown): string {
  return getProviderRegistryEntry(provider).displayName;
}

export function getAllProviderSecretSettingKeys(): readonly LlmProviderSecretSettingKey[] {
  return Array.from(new Set(listProviderRegistryEntries().flatMap((entry) => entry.secretSettingKeys)));
}

export function validateProviderReadiness(settings: SettingsLike): ProviderReadinessValidation {
  return getProviderRegistryEntry(settings.llmProvider).readinessValidator(settings);
}

export function buildProviderCacheFingerprint(provider: unknown, args: ProviderCacheFingerprintArgs): string {
  return getProviderRegistryEntry(provider).cacheFingerprint(args);
}

export function buildProviderConfigFingerprint(provider: unknown, args: ProviderConfigFingerprintArgs): string {
  const normalizedProvider = normalizeLlmProvider(provider);
  return `${LLM_CONFIG_KEY_PREFIX}_${normalizedProvider}_${buildProviderConfigDigest(normalizedProvider, args)}`;
}

export function createProviderTranslator(args: ProviderTranslatorFactoryArgs): Translator {
  return getProviderRegistryEntry(args.settings.llmProvider).translatorFactory(args);
}

export { ClaudeTranslator, GeminiTranslator, OpenAiCompatibleTranslator, VertexTranslator };
