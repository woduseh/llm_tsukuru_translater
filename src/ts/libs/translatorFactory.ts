import {
  DEFAULT_LLM_PROVIDER,
  type LlmProvider,
} from '../../types/settings';
import type { BlockValidation, TranslationLogEntry } from './translationCore';
import {
  createGeminiTranslator,
  GeminiTranslator,
} from './geminiTranslator';

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

export function createTranslator(
  settings: Record<string, any>,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
): Translator {
  const provider = normalizeLlmProvider(settings.llmProvider);
  if (provider === 'vertex') {
    throw new Error(`${getLlmProviderDisplayName(provider)} support is not implemented yet.`);
  }
  return createGeminiTranslator(settings, sourceLang, targetLang, isAborted);
}

export { GeminiTranslator };
