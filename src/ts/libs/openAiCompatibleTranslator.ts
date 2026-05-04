import axios from 'axios';
import type { AppSettings } from '../../types/settings';
import { DEFAULT_API_TIMEOUT_SEC } from './constants';
import { ProviderTranslationBase, type ProviderTranslationConfig } from './providerTranslationBase';
import {
  buildTranslationSystemPrompt,
  buildTranslationUserMessage,
  stripMarkdownFences,
} from './translationPrompt';

interface OpenAiCompatibleConfig extends ProviderTranslationConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  customPrompt: string;
  sourceLang: string;
  targetLang: string;
  timeout: number;
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

function getProviderErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  const apiMessage = (data as { error?: { message?: unknown } })?.error?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error);
}

function getProviderErrorStatus(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function redactSecret(message: string, secret?: string): string {
  return secret && secret.trim() ? message.split(secret).join('[REDACTED]') : message;
}

function normalizeOpenAiError(error: unknown, apiKey?: string): Error {
  if (error instanceof Error && error.message.startsWith('OpenAI-compatible API ')) return error;
  const status = getProviderErrorStatus(error);
  const message = redactSecret(getProviderErrorMessage(error), apiKey);
  if (status === 401 || status === 403) return new Error(`OpenAI-compatible API authentication failed: ${message}`);
  if (status === 429) return new Error(`OpenAI-compatible API rate limit (429): ${message}`);
  if ((error as { code?: unknown })?.code === 'ECONNABORTED') return new Error(`OpenAI-compatible API timeout: ${message}`);
  return new Error(`OpenAI-compatible API error: ${message}`);
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
      throw normalizeOpenAiError(error, this.config.apiKey);
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
    apiKey: settings.llmOpenAiApiKey || '',
    baseUrl: OPENAI_BASE_URL,
    model: settings.llmModel || '',
    customPrompt: settings.llmCustomPrompt || '',
    chunkSize: settings.llmChunkSize || 30,
    translationUnit: settings.llmTranslationUnit || 'file',
    sourceLang,
    targetLang,
    doNotTransHangul: !!settings.DoNotTransHangul,
    maxRetries: settings.llmMaxRetries ?? 2,
    maxApiRetries: settings.llmMaxApiRetries ?? 5,
    timeout: (settings.llmTimeout || DEFAULT_API_TIMEOUT_SEC) * 1000,
    isAborted,
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
    apiKey: settings.llmCustomApiKey || '',
    baseUrl: settings.llmCustomBaseUrl || '',
    model: settings.llmModel || '',
    customPrompt: settings.llmCustomPrompt || '',
    chunkSize: settings.llmChunkSize || 30,
    translationUnit: settings.llmTranslationUnit || 'file',
    sourceLang,
    targetLang,
    doNotTransHangul: !!settings.DoNotTransHangul,
    maxRetries: settings.llmMaxRetries ?? 2,
    maxApiRetries: settings.llmMaxApiRetries ?? 5,
    timeout: (settings.llmTimeout || DEFAULT_API_TIMEOUT_SEC) * 1000,
    isAborted,
  }, deps);
}
