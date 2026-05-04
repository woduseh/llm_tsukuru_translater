import type { AppSettings, LlmProvider } from './settings';

export type LlmProviderSettingKey = Extract<keyof AppSettings, string>;
export type LlmProviderSecretSettingKey =
  | 'llmApiKey'
  | 'llmVertexServiceAccountJson'
  | 'llmOpenAiApiKey'
  | 'llmCustomApiKey'
  | 'llmClaudeApiKey';
export type LlmProviderCapability = 'bulkTranslate' | 'retranslate' | 'jsonRepair' | 'liveHarness';

export interface LlmProviderSettingFieldContract {
  key: LlmProviderSettingKey;
  label: string;
  kind: 'text' | 'password' | 'textarea' | 'select' | 'number';
  secret: boolean;
  required: boolean;
  rendererSafe: boolean;
}

export interface LlmProviderMetadataContract {
  id: LlmProvider;
  displayName: string;
  defaultModel: string;
  modelSuggestions: readonly string[];
  settingFields: readonly LlmProviderSettingFieldContract[];
  credentialSettingKeys: readonly LlmProviderSettingKey[];
  secretSettingKeys: readonly LlmProviderSecretSettingKey[];
  cacheKeyParts: readonly LlmProviderSettingKey[];
  maxRecommendedConcurrency: number;
  capabilities: readonly LlmProviderCapability[];
}

export const LLM_PROVIDER_SECRET_SETTING_KEYS = [
  'llmApiKey',
  'llmVertexServiceAccountJson',
  'llmOpenAiApiKey',
  'llmCustomApiKey',
  'llmClaudeApiKey',
] as const satisfies readonly LlmProviderSecretSettingKey[];

export const LLM_PROVIDER_METADATA = {
  gemini: {
    id: 'gemini',
    displayName: 'Gemini API',
    defaultModel: 'gemini-2.5-flash',
    modelSuggestions: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    settingFields: [
      {
        key: 'llmApiKey',
        label: 'Gemini API key',
        kind: 'password',
        secret: true,
        required: true,
        rendererSafe: false,
      },
      {
        key: 'llmModel',
        label: 'Model',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
    ],
    credentialSettingKeys: ['llmApiKey'],
    secretSettingKeys: ['llmApiKey'],
    cacheKeyParts: ['llmProvider', 'llmModel', 'llmTargetLang', 'llmSourceLang', 'llmCustomPrompt'],
    maxRecommendedConcurrency: 1,
    capabilities: ['bulkTranslate', 'retranslate', 'jsonRepair', 'liveHarness'],
  },
  vertex: {
    id: 'vertex',
    displayName: 'Vertex AI',
    defaultModel: 'gemini-2.5-pro',
    modelSuggestions: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    settingFields: [
      {
        key: 'llmVertexServiceAccountJson',
        label: 'Vertex service account JSON',
        kind: 'textarea',
        secret: true,
        required: true,
        rendererSafe: false,
      },
      {
        key: 'llmVertexLocation',
        label: 'Vertex location',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
      {
        key: 'llmModel',
        label: 'Model',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
    ],
    credentialSettingKeys: ['llmVertexServiceAccountJson', 'llmVertexLocation'],
    secretSettingKeys: ['llmVertexServiceAccountJson'],
    cacheKeyParts: ['llmProvider', 'llmModel', 'llmTargetLang', 'llmSourceLang', 'llmCustomPrompt', 'llmVertexLocation'],
    maxRecommendedConcurrency: 1,
    capabilities: ['bulkTranslate', 'retranslate', 'jsonRepair', 'liveHarness'],
  },
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    modelSuggestions: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
    settingFields: [
      {
        key: 'llmOpenAiApiKey',
        label: 'OpenAI API key',
        kind: 'password',
        secret: true,
        required: true,
        rendererSafe: false,
      },
      {
        key: 'llmModel',
        label: 'Model',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
    ],
    credentialSettingKeys: ['llmOpenAiApiKey'],
    secretSettingKeys: ['llmOpenAiApiKey'],
    cacheKeyParts: ['llmProvider', 'llmModel', 'llmTargetLang', 'llmSourceLang', 'llmCustomPrompt'],
    maxRecommendedConcurrency: 2,
    capabilities: ['bulkTranslate', 'retranslate', 'jsonRepair', 'liveHarness'],
  },
  'custom-openai': {
    id: 'custom-openai',
    displayName: 'OpenAI 호환 API',
    defaultModel: 'local-model',
    modelSuggestions: ['local-model', 'gpt-oss-20b', 'llama-3.1-8b-instruct'],
    settingFields: [
      {
        key: 'llmCustomBaseUrl',
        label: 'Base URL',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
      {
        key: 'llmCustomApiKey',
        label: 'API key (optional)',
        kind: 'password',
        secret: true,
        required: false,
        rendererSafe: false,
      },
      {
        key: 'llmModel',
        label: 'Model',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
    ],
    credentialSettingKeys: ['llmCustomBaseUrl', 'llmCustomApiKey'],
    secretSettingKeys: ['llmCustomApiKey'],
    cacheKeyParts: ['llmProvider', 'llmCustomBaseUrl', 'llmModel', 'llmTargetLang', 'llmSourceLang', 'llmCustomPrompt'],
    maxRecommendedConcurrency: 2,
    capabilities: ['bulkTranslate', 'retranslate', 'jsonRepair', 'liveHarness'],
  },
  claude: {
    id: 'claude',
    displayName: 'Claude',
    defaultModel: 'claude-3-5-haiku-latest',
    modelSuggestions: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-5'],
    settingFields: [
      {
        key: 'llmClaudeApiKey',
        label: 'Claude API key',
        kind: 'password',
        secret: true,
        required: true,
        rendererSafe: false,
      },
      {
        key: 'llmModel',
        label: 'Model',
        kind: 'text',
        secret: false,
        required: true,
        rendererSafe: true,
      },
      {
        key: 'llmMaxTokens',
        label: 'Max tokens',
        kind: 'number',
        secret: false,
        required: true,
        rendererSafe: true,
      },
    ],
    credentialSettingKeys: ['llmClaudeApiKey'],
    secretSettingKeys: ['llmClaudeApiKey'],
    cacheKeyParts: ['llmProvider', 'llmModel', 'llmTargetLang', 'llmSourceLang', 'llmCustomPrompt'],
    maxRecommendedConcurrency: 2,
    capabilities: ['bulkTranslate', 'retranslate', 'jsonRepair', 'liveHarness'],
  },
} as const satisfies Record<LlmProvider, LlmProviderMetadataContract>;

export const LLM_PROVIDER_UI_TEXT = {
  gemini: {
    configHint: 'Gemini API 키를 입력하면 번역, 재번역, JSON 검증 복구에 그대로 사용됩니다.',
    missingConfigMessage: 'Gemini API 설정이 완료되지 않았습니다. 메인 설정에서 API 키와 모델을 확인해주세요.',
  },
  vertex: {
    configHint: 'Google Cloud 서비스 계정 JSON 전체를 붙여넣고 Vertex 위치는 기본값 global을 사용하세요.',
    missingConfigMessage: 'Vertex AI 설정이 완료되지 않았습니다. 메인 설정에서 서비스 계정 JSON, 위치, 모델을 확인해주세요.',
  },
  openai: {
    configHint: 'OpenAI API 키와 모델을 입력하세요. 공식 Chat Completions API를 사용합니다.',
    missingConfigMessage: 'OpenAI 설정이 완료되지 않았습니다. API 키와 모델을 확인해주세요.',
  },
  'custom-openai': {
    configHint: 'LM Studio, LocalAI, vLLM 등 OpenAI Chat Completions 호환 /v1 Base URL을 입력하세요. API 키는 선택입니다.',
    missingConfigMessage: 'OpenAI 호환 API 설정이 완료되지 않았습니다. Base URL과 모델을 확인해주세요.',
  },
  claude: {
    configHint: 'Claude API 키, 모델, 최대 토큰 수를 입력하세요. Anthropic Messages API를 사용합니다.',
    missingConfigMessage: 'Claude 설정이 완료되지 않았습니다. API 키, 모델, 최대 토큰 수를 확인해주세요.',
  },
} as const satisfies Record<LlmProvider, { configHint: string; missingConfigMessage: string }>;

export function isLlmProviderId(value: unknown): value is LlmProvider {
  return value === 'gemini'
    || value === 'vertex'
    || value === 'openai'
    || value === 'custom-openai'
    || value === 'claude';
}

export function getRendererLlmProviderMetadata(provider: unknown): LlmProviderMetadataContract {
  return LLM_PROVIDER_METADATA[isLlmProviderId(provider) ? provider : 'gemini'];
}

export function getRendererLlmProviderUiText(provider: unknown): { configHint: string; missingConfigMessage: string } {
  return LLM_PROVIDER_UI_TEXT[isLlmProviderId(provider) ? provider : 'gemini'];
}

export function getLlmProviderMetadata(provider: LlmProvider): LlmProviderMetadataContract {
  return LLM_PROVIDER_METADATA[provider];
}
