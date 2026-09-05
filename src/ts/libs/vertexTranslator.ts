import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';
import { type AppSettings, DEFAULT_LLM_VERTEX_LOCATION } from '../../types/settings';
import { buildTranslationSystemPrompt, buildTranslationUserMessage, stripMarkdownFences } from './translationPrompt';
import {
  parseVertexServiceAccountJson,
  type VertexServiceAccountJson,
} from './vertexCredentials';
import {
  getApiErrorMessage,
  getApiErrorStatus,
  isPermanentApiError,
  isRetryableApiError,
} from './translationCore';
import { ProviderTranslationBase, createProviderTranslatorConfig, type ProviderTranslatorConfig } from './providerTranslationBase';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

interface VertexConfig extends ProviderTranslatorConfig {
  credentials: VertexServiceAccountJson;
  location: string;
}

interface AccessTokenClient {
  getAccessToken(): Promise<unknown>;
}

interface AccessTokenAuth {
  getClient(): Promise<AccessTokenClient>;
}

interface VertexDependencies {
  httpClient?: {
    post: typeof axios.post;
  };
  accessTokenProvider?: () => Promise<string>;
  createGoogleAuth?: (options: { credentials: VertexServiceAccountJson; scopes: string[] }) => AccessTokenAuth;
}

function normalizeVertexLocation(location: string): string {
  const trimmed = location.trim();
  return trimmed || DEFAULT_LLM_VERTEX_LOCATION;
}

function normalizeVertexModel(model: string): string {
  const trimmed = model.trim();
  if (trimmed.includes('/models/')) {
    return trimmed.split('/models/').pop() || trimmed;
  }
  return trimmed;
}

function resolveAccessToken(rawToken: unknown): string {
  if (typeof rawToken === 'string' && rawToken.trim()) {
    return rawToken.trim();
  }

  if (rawToken && typeof rawToken === 'object') {
    const token = (rawToken as { token?: unknown }).token;
    if (typeof token === 'string' && token.trim()) {
      return token.trim();
    }
  }

  throw new Error('Vertex AI access token was not returned.');
}

function isVertexAuthError(error: unknown): boolean {
  const status = getApiErrorStatus(error);
  const msg = getApiErrorMessage(error).toLowerCase();

  return status === 401
    || status === 403
    || msg.includes('authentication failed')
    || msg.includes('invalid_grant')
    || msg.includes('invalid jwt')
    || msg.includes('private key')
    || msg.includes('permission denied')
    || msg.includes('service account');
}

function normalizeVertexError(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith('Vertex AI ')) {
    return error;
  }

  if (isVertexAuthError(error)) {
    return new Error(`Vertex AI authentication failed: ${getApiErrorMessage(error)}`);
  }

  return error instanceof Error ? error : new Error(getApiErrorMessage(error));
}

function isPermanentVertexError(error: unknown): boolean {
  return isPermanentApiError(error) || isVertexAuthError(error);
}

function isRetryableVertexError(error: unknown): boolean {
  return !isVertexAuthError(error) && isRetryableApiError(error);
}

export function buildVertexApiUrl(projectId: string, location: string, model: string): string {
  const normalizedLocation = normalizeVertexLocation(location);
  const normalizedModel = normalizeVertexModel(model);
  const baseUrl = normalizedLocation === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${normalizedLocation}-aiplatform.googleapis.com`;

  return `${baseUrl}/v1/projects/${projectId}/locations/${normalizedLocation}/publishers/google/models/${normalizedModel}:generateContent`;
}

export function createVertexAccessTokenProvider(
  credentials: VertexServiceAccountJson,
  deps: Pick<VertexDependencies, 'createGoogleAuth'> = {},
): () => Promise<string> {
  const createGoogleAuth = deps.createGoogleAuth || ((options) => new GoogleAuth(options));
  const auth = createGoogleAuth({
    credentials,
    scopes: [CLOUD_PLATFORM_SCOPE],
  });

  return async () => {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return resolveAccessToken(token);
  };
}

export class VertexTranslator extends ProviderTranslationBase {
  private config: VertexConfig;
  private apiUrl: string;
  private httpClient: NonNullable<VertexDependencies['httpClient']>;
  private accessTokenProvider: () => Promise<string>;

  constructor(config: VertexConfig, deps: VertexDependencies = {}) {
    super({
      ...config,
      isPermanentError: isPermanentVertexError,
      isRetryableError: isRetryableVertexError,
    });
    this.config = config;
    this.apiUrl = buildVertexApiUrl(config.credentials.project_id, config.location, config.model);
    this.httpClient = deps.httpClient || axios;
    this.accessTokenProvider = deps.accessTokenProvider || createVertexAccessTokenProvider(config.credentials, deps);
  }

  async translateText(text: string): Promise<string> {
    try {
      const accessToken = await this.accessTokenProvider();
      const response = await this.httpClient.post(this.apiUrl, {
        contents: [
          {
            role: 'user',
            parts: [{ text: buildTranslationUserMessage(text) }],
          },
        ],
        systemInstruction: {
          role: 'system',
          parts: [{ text: buildTranslationSystemPrompt(this.config, 'google') }],
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: this.config.timeout,
      });

      const candidates = response.data?.candidates;
      if (!candidates || candidates.length === 0) {
        const blockReason = response.data?.promptFeedback?.blockReason;
        const message = blockReason
          ? `Vertex AI blocked (${blockReason})`
          : 'Vertex AI returned no candidates';
        throw new Error(message);
      }

      const translated = candidates[0]?.content?.parts?.[0]?.text || '';
      return stripMarkdownFences(translated);
    } catch (error) {
      throw normalizeVertexError(error);
    }
  }

}

export function createVertexTranslator(
  settings: Partial<AppSettings>,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
  deps: VertexDependencies = {},
): VertexTranslator {
  const credentials = parseVertexServiceAccountJson(settings.llmVertexServiceAccountJson || '');

  return new VertexTranslator({
    ...createProviderTranslatorConfig(settings, sourceLang, targetLang, isAborted),
    credentials,
    location: normalizeVertexLocation(settings.llmVertexLocation || DEFAULT_LLM_VERTEX_LOCATION),
  }, deps);
}
