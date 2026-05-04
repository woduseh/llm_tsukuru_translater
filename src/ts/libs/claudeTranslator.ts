import axios from 'axios';
import type { AppSettings } from '../../types/settings';
import { DEFAULT_API_TIMEOUT_SEC } from './constants';
import { ProviderTranslationBase, type ProviderTranslationConfig } from './providerTranslationBase';
import {
  buildTranslationSystemPrompt,
  buildTranslationUserMessage,
  stripMarkdownFences,
} from './translationPrompt';

interface ClaudeConfig extends ProviderTranslationConfig {
  apiKey: string;
  model: string;
  customPrompt: string;
  sourceLang: string;
  targetLang: string;
  timeout: number;
  maxTokens: number;
}

interface ClaudeDependencies {
  httpClient?: {
    post: typeof axios.post;
  };
}

export const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

function getClaudeErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  const apiMessage = (data as { error?: { message?: unknown } })?.error?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error);
}

function getClaudeErrorStatus(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function redactSecret(message: string, secret?: string): string {
  return secret && secret.trim() ? message.split(secret).join('[REDACTED]') : message;
}

function normalizeClaudeError(error: unknown, apiKey: string): Error {
  if (error instanceof Error && error.message.startsWith('Claude API ')) return error;
  const status = getClaudeErrorStatus(error);
  const message = redactSecret(getClaudeErrorMessage(error), apiKey);
  if (status === 401 || status === 403) return new Error(`Claude API authentication failed: ${message}`);
  if (status === 429) return new Error(`Claude API rate limit (429): ${message}`);
  if ((error as { code?: unknown })?.code === 'ECONNABORTED') return new Error(`Claude API timeout: ${message}`);
  return new Error(`Claude API error: ${message}`);
}

export class ClaudeTranslator extends ProviderTranslationBase {
  private readonly config: ClaudeConfig;
  private readonly httpClient: NonNullable<ClaudeDependencies['httpClient']>;

  constructor(config: ClaudeConfig, deps: ClaudeDependencies = {}) {
    super(config);
    this.config = config;
    this.httpClient = deps.httpClient || axios;
  }

  async translateText(text: string): Promise<string> {
    try {
      const response = await this.httpClient.post(CLAUDE_MESSAGES_URL, {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: buildTranslationSystemPrompt(this.config),
        messages: [
          {
            role: 'user',
            content: buildTranslationUserMessage(text),
          },
        ],
      }, {
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': this.config.apiKey,
        },
        timeout: this.config.timeout,
      });
      const translated = response.data?.content?.find((part: { type?: unknown; text?: unknown }) => part?.type === 'text')?.text;
      if (typeof translated !== 'string' || !translated.trim()) {
        throw new Error('Claude API returned malformed response.');
      }
      return stripMarkdownFences(translated);
    } catch (error) {
      throw normalizeClaudeError(error, this.config.apiKey);
    }
  }
}

export function createClaudeTranslator(
  settings: Partial<AppSettings>,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
  deps: ClaudeDependencies = {},
): ClaudeTranslator {
  return new ClaudeTranslator({
    apiKey: settings.llmClaudeApiKey || '',
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
    maxTokens: settings.llmMaxTokens || 4096,
    isAborted,
  }, deps);
}
