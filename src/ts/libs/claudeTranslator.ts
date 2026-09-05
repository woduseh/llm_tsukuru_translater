import axios from 'axios';
import { normalizeProviderApiError } from './translationCore';
import type { AppSettings } from '../../types/settings';
import { ProviderTranslationBase, createProviderTranslatorConfig, type ProviderTranslatorConfig } from './providerTranslationBase';
import {
  buildTranslationSystemPrompt,
  buildTranslationUserMessage,
  stripMarkdownFences,
} from './translationPrompt';

interface ClaudeConfig extends ProviderTranslatorConfig {
  apiKey: string;
  maxTokens: number;
}

interface ClaudeDependencies {
  httpClient?: {
    post: typeof axios.post;
  };
}

export const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

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
      throw normalizeProviderApiError(error, 'Claude', this.config.apiKey);
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
    ...createProviderTranslatorConfig(settings, sourceLang, targetLang, isAborted),
    apiKey: settings.llmClaudeApiKey || '',
    maxTokens: settings.llmMaxTokens || 4096,
  }, deps);
}
