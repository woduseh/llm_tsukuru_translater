import axios from 'axios';
import { normalizeProviderApiError } from './translationCore';
import type { AppSettings } from '../../types/settings';
import { ProviderTranslationBase, createProviderTranslatorConfig, type ProviderTranslatorConfig } from './providerTranslationBase';
import {
  buildTranslationSystemPrompt,
  buildTranslationUserMessage,
  stripMarkdownFences,
} from './translationPrompt';

interface OpenAiCompatibleConfig extends ProviderTranslatorConfig {
  apiKey?: string;
  baseUrl: string;
}

interface OpenAiCompatibleDependencies {
  httpClient?: {
    post: typeof axios.post;
  };
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('OpenAI-compatible base URL is required.');
  return trimmed.endsWith('/chat/completions')
    ? trimmed.slice(0, -'/chat/completions'.length)
    : trimmed;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export class OpenAiCompatibleTranslator extends ProviderTranslationBase {
  private readonly config: OpenAiCompatibleConfig;
  private readonly httpClient: NonNullable<OpenAiCompatibleDependencies['httpClient']>;
  private readonly apiUrl: string;

  constructor(config: OpenAiCompatibleConfig, deps: OpenAiCompatibleDependencies = {}) {
    super(config);
    this.config = config;
    this.httpClient = deps.httpClient || axios;
    this.apiUrl = buildChatCompletionsUrl(config.baseUrl);
  }

  async translateText(text: string): Promise<string> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.apiKey?.trim()) headers.Authorization = `Bearer ${this.config.apiKey.trim()}`;
      const response = await this.httpClient.post(this.apiUrl, {
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: buildTranslationSystemPrompt(this.config),
          },
          {
            role: 'user',
            content: buildTranslationUserMessage(text),
          },
        ],
      }, {
        headers,
        timeout: this.config.timeout,
      });
      const translated = response.data?.choices?.[0]?.message?.content;
      if (typeof translated !== 'string' || !translated.trim()) {
        throw new Error('OpenAI-compatible API returned malformed response.');
      }
      return stripMarkdownFences(translated);
    } catch (error) {
      throw normalizeProviderApiError(error, 'OpenAI-compatible', this.config.apiKey);
    }
  }
}

export function createOpenAiTranslator(
  settings: Partial<AppSettings>,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
  deps: OpenAiCompatibleDependencies = {},
): OpenAiCompatibleTranslator {
  return new OpenAiCompatibleTranslator({
    ...createProviderTranslatorConfig(settings, sourceLang, targetLang, isAborted),
    apiKey: settings.llmOpenAiApiKey || '',
    baseUrl: OPENAI_BASE_URL,
  }, deps);
}

export function createCustomOpenAiTranslator(
  settings: Partial<AppSettings>,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
  deps: OpenAiCompatibleDependencies = {},
): OpenAiCompatibleTranslator {
  return new OpenAiCompatibleTranslator({
    ...createProviderTranslatorConfig(settings, sourceLang, targetLang, isAborted),
    apiKey: settings.llmCustomApiKey || '',
    baseUrl: settings.llmCustomBaseUrl || '',
  }, deps);
}
