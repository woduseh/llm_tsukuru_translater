import {
  AppSettings,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_VERTEX_LOCATION,
  LlmProvider,
} from '../../types/settings';

const VERTEX_REQUIRED_FIELDS = ['client_email', 'private_key', 'project_id'] as const;

type SecretSettingKeys = 'llmApiKey' | 'llmVertexServiceAccountJson';

export interface VertexServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id: string;
  [key: string]: unknown;
}

export interface LlmSettingsValidation {
  llmProvider: LlmProvider;
  llmVertexLocation: string;
  llmReady: boolean;
  llmHasApiKey: boolean;
  llmHasVertexServiceAccountJson: boolean;
  llmValidationErrors: string[];
}

export interface LlmStartWindowState extends Pick<LlmSettingsValidation, 'llmProvider' | 'llmVertexLocation' | 'llmReady' | 'llmHasApiKey' | 'llmHasVertexServiceAccountJson'> {
  llmSortOrder: string;
  themeData: Record<string, string>;
}

export interface VerifyWindowState extends Pick<LlmSettingsValidation, 'llmProvider' | 'llmVertexLocation' | 'llmReady' | 'llmHasApiKey' | 'llmHasVertexServiceAccountJson'> {
  JsonChangeLine: boolean;
  themeData: Record<string, string>;
}

type SanitizedSettings<T extends Record<string, unknown>> = Omit<T, SecretSettingKeys>;

function hasConfiguredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeLlmProvider(value: unknown): LlmProvider {
  return value === 'vertex' ? 'vertex' : DEFAULT_LLM_PROVIDER;
}

function getVertexLocation(value: unknown): string {
  return hasConfiguredText(value) ? value.trim() : DEFAULT_LLM_VERTEX_LOCATION;
}

function getProviderMetadata(settings: AppSettings): Pick<LlmSettingsValidation, 'llmProvider' | 'llmVertexLocation' | 'llmReady' | 'llmHasApiKey' | 'llmHasVertexServiceAccountJson'> {
  const validation = validateLlmSettings(settings);
  return {
    llmProvider: validation.llmProvider,
    llmVertexLocation: validation.llmVertexLocation,
    llmReady: validation.llmReady,
    llmHasApiKey: validation.llmHasApiKey,
    llmHasVertexServiceAccountJson: validation.llmHasVertexServiceAccountJson,
  };
}

export function getLlmProviderConfigHint(provider: unknown): string {
  return normalizeLlmProvider(provider) === 'vertex'
    ? 'Google Cloud 서비스 계정 JSON 전체를 붙여넣고 Vertex 위치는 기본값 global을 사용하세요.'
    : 'Gemini API 키를 입력하면 번역, 재번역, JSON 검증 복구에 그대로 사용됩니다.';
}

export function getLlmProviderMissingConfigMessage(provider: unknown): string {
  return normalizeLlmProvider(provider) === 'vertex'
    ? 'Vertex AI 설정이 완료되지 않았습니다. 메인 설정에서 서비스 계정 JSON, 위치, 모델을 확인해주세요.'
    : 'Gemini API 설정이 완료되지 않았습니다. 메인 설정에서 API 키와 모델을 확인해주세요.';
}

export function sanitizeSettingsForRenderer<T extends Record<string, unknown>>(settings: T): SanitizedSettings<T> {
  const { llmApiKey: _llmApiKey, llmVertexServiceAccountJson: _llmVertexServiceAccountJson, ...safeSettings } = settings;
  return safeSettings as SanitizedSettings<T>;
}

export function parseVertexServiceAccountJson(serviceAccountJson: string): VertexServiceAccountJson {
  if (!hasConfiguredText(serviceAccountJson)) {
    throw new Error('Vertex service account JSON is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountJson.trim());
  } catch {
    throw new Error('Vertex service account JSON could not be parsed.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vertex service account JSON must be an object.');
  }

  const credentials = parsed as Record<string, unknown>;
  for (const field of VERTEX_REQUIRED_FIELDS) {
    if (!hasConfiguredText(credentials[field])) {
      throw new Error(`Vertex service account JSON is missing ${field}.`);
    }
  }

  return credentials as VertexServiceAccountJson;
}

export function validateLlmSettings(settings: AppSettings): LlmSettingsValidation {
  const llmProvider = normalizeLlmProvider(settings.llmProvider);
  const llmVertexLocation = getVertexLocation(settings.llmVertexLocation);
  const llmHasApiKey = hasConfiguredText(settings.llmApiKey);
  const llmHasVertexServiceAccountJson = hasConfiguredText(settings.llmVertexServiceAccountJson);
  const llmValidationErrors: string[] = [];

  if (!hasConfiguredText(settings.llmModel)) {
    llmValidationErrors.push('LLM model is required.');
  }

  if (llmProvider === 'vertex') {
    try {
      parseVertexServiceAccountJson(settings.llmVertexServiceAccountJson);
    } catch (error) {
      llmValidationErrors.push((error as Error).message);
    }
  } else if (!llmHasApiKey) {
    llmValidationErrors.push('Gemini API key is required.');
  }

  return {
    llmProvider,
    llmVertexLocation,
    llmReady: llmValidationErrors.length === 0,
    llmHasApiKey,
    llmHasVertexServiceAccountJson,
    llmValidationErrors,
  };
}

export function buildLlmStartWindowState(settings: AppSettings): LlmStartWindowState {
  return {
    llmSortOrder: settings.llmSortOrder || 'name-asc',
    themeData: settings.themeData || {},
    ...getProviderMetadata(settings),
  };
}

export function buildVerifyWindowState(settings: AppSettings): VerifyWindowState {
  return {
    JsonChangeLine: !!settings.JsonChangeLine,
    themeData: settings.themeData || {},
    ...getProviderMetadata(settings),
  };
}
