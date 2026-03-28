import {
  type AppSettings,
  DEFAULT_LLM_PROVIDER,
  type LlmProvider,
} from '../../types/settings';
import type { BlockValidation, TranslationLogEntry } from './translationCore';
import { validateLlmSettings } from './llmProviderConfig';
import {
  createGeminiTranslator,
  GeminiTranslator,
} from './geminiTranslator';
import {
  createVertexTranslator,
  VertexTranslator,
} from './vertexTranslator';

type LlmSettingsLike = Partial<AppSettings> & Record<string, unknown>;

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

export function normalizeLlmProvider(value: unknown): LlmProvider {
  return value === 'vertex' ? 'vertex' : DEFAULT_LLM_PROVIDER;
}

export function getLlmProviderDisplayName(provider: unknown): string {
  return normalizeLlmProvider(provider) === 'vertex' ? 'Vertex AI' : 'Gemini API';
}

export function buildTranslationCacheKey(provider: unknown, hash: string, model: string, targetLang: string): string {
  return `${normalizeLlmProvider(provider)}_${hash}_${model}_${targetLang}`;
}

export function getLlmReadinessError(settings: LlmSettingsLike): string | null {
  const validation = validateLlmSettings(settings as AppSettings);
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
  const provider = normalizeLlmProvider(settings.llmProvider);
  if (provider === 'vertex') {
    return createVertexTranslator(settings, sourceLang, targetLang, isAborted);
  }
  return createGeminiTranslator(settings, sourceLang, targetLang, isAborted);
}

export { GeminiTranslator, VertexTranslator };
