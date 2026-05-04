import type { AppSettings } from '../../types/settings';
import {
  buildProviderCacheFingerprint,
  ClaudeTranslator,
  createProviderTranslator,
  GeminiTranslator,
  getLlmProviderDisplayName,
  normalizeLlmProvider,
  OpenAiCompatibleTranslator,
  validateProviderReadiness,
  VertexTranslator,
} from './providerRegistry';
import type { BlockValidation, TranslationLogEntry } from './translationCore';

export interface Translator {
  translateText(text: string): Promise<string>;
  translateFileContent(
    content: string,
    onProgress?: (current: number, total: number, detail: string) => void
  ): Promise<{
    translatedContent: string;
    validation: BlockValidation[];
    logEntry: Partial<TranslationLogEntry>;
    aborted?: boolean;
  }>;
}

type LlmSettingsLike = Partial<AppSettings> & Record<string, unknown>;

export { getLlmProviderDisplayName, normalizeLlmProvider };

export function buildTranslationCacheKey(provider: unknown, hash: string, model: string, targetLang: string, settings?: LlmSettingsLike): string {
  return buildProviderCacheFingerprint(provider, { hash, model, targetLang, settings });
}

export function getLlmReadinessError(settings: LlmSettingsLike): string | null {
  const validation = validateProviderReadiness(settings);
  if (validation.llmReady) {
    return null;
  }

  if (validation.llmValidationErrors.includes('LLM model is required.')) {
    return 'LLM 모델이 설정되지 않았습니다.';
  }

  if (validation.llmProvider === 'vertex') {
    return validation.llmHasVertexServiceAccountJson
      ? `Vertex AI 서비스 계정 JSON을 확인해주세요: ${validation.llmValidationErrors[0]}`
      : 'Vertex AI 서비스 계정 JSON이 설정되지 않았습니다.';
  }
  if (validation.llmProvider === 'openai') {
    return validation.llmValidationErrors.includes('LLM model is required.')
      ? 'LLM 모델이 설정되지 않았습니다.'
      : 'OpenAI API 키가 설정되지 않았습니다.';
  }
  if (validation.llmProvider === 'custom-openai') {
    return validation.llmValidationErrors[0] || 'OpenAI 호환 API 설정을 확인해주세요.';
  }
  if (validation.llmProvider === 'claude') {
    return validation.llmValidationErrors.includes('LLM model is required.')
      ? 'LLM 모델이 설정되지 않았습니다.'
      : 'Claude API 키 또는 최대 토큰 설정을 확인해주세요.';
  }

  return 'Gemini API 키가 설정되지 않았습니다.';
}

export function assertLlmReady(settings: LlmSettingsLike): void {
  const error = getLlmReadinessError(settings);
  if (error) {
    throw new Error(error);
  }
}

export function createTranslator(
  settings: LlmSettingsLike,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
): Translator {
  return createProviderTranslator({ settings, sourceLang, targetLang, isAborted });
}

export { ClaudeTranslator, GeminiTranslator, OpenAiCompatibleTranslator, VertexTranslator };
