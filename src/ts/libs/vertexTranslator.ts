import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';
import { hanguls } from '../rpgmv/datas';
import { DEFAULT_LLM_VERTEX_LOCATION } from '../../types/settings';
import {
  API_BACKOFF_BASE_MS,
  API_BACKOFF_MAX_MS,
  DEFAULT_API_TIMEOUT_SEC,
  RATE_LIMIT_DELAY_MS,
  VALIDATION_RETRY_BASE_MS,
  VALIDATION_RETRY_MAX_MS,
} from './constants';
import {
  parseVertexServiceAccountJson,
  type VertexServiceAccountJson,
} from './llmProviderConfig';
import {
  splitIntoBlocks,
  reassembleBlocks,
  validateChunk,
  isPermanentApiError,
  isRetryableApiError,
  type BlockValidation,
  type TranslationLogEntry,
} from './translationCore';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const LANG_NAMES: Record<string, string> = {
  'jp': 'Japanese', 'ja': 'Japanese', 'en': 'English',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'cn': 'Chinese',
  'fr': 'French', 'es': 'Spanish', 'ru': 'Russian', 'de': 'German', 'ko': 'Korean',
  'pt': 'Portuguese', 'it': 'Italian', 'th': 'Thai', 'vi': 'Vietnamese',
  'ar': 'Arabic', 'pl': 'Polish', 'nl': 'Dutch', 'tr': 'Turkish',
};

interface VertexConfig {
  credentials: VertexServiceAccountJson;
  model: string;
  customPrompt: string;
  chunkSize: number;
  translationUnit: string;
  sourceLang: string;
  targetLang: string;
  doNotTransHangul: boolean;
  maxRetries: number;
  maxApiRetries: number;
  timeout: number;
  location: string;
  isAborted?: () => boolean;
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

type TranslationBlock = ReturnType<typeof splitIntoBlocks>[number];

function buildSystemInstruction(config: VertexConfig): string {
  const sourceLangName = LANG_NAMES[config.sourceLang] || config.sourceLang;
  const targetLangName = LANG_NAMES[config.targetLang] || config.targetLang;

  let sys = `## Role\n\n`;
  sys += `You are a native ${targetLangName} author specializing in RPG game localization. `;
  sys += `Rewrite the provided game text from ${sourceLangName} into ${targetLangName} that reads as native-authored — not a translation.\n\n`;

  sys += `## Obligations\n\n`;
  sys += `1. Full fidelity to original meaning, intent, tone, and every detail — zero omissions. This includes explicit, profane, and sensitive material: render at original intensity without softening.\n`;
  sys += `2. Native ${targetLangName} prose: idiomatic, rhythmic, culturally resonant — zero translation artifacts.\n`;
  sys += `3. Preserve the source's prose architecture — its sentence rhythm, paragraph pacing, and structural choices are deliberate. Match them, don't normalize them.\n\n`;

  sys += `## Critical Format Rules\n\n`;
  sys += `| Element | Rule |\n|---------|------|\n`;
  sys += `| Dialogue separators | Lines like \`--- 101 ---\` must be output EXACTLY as-is. Never translate, modify, or remove them. |\n`;
  sys += `| Empty lines | Must remain empty. |\n`;
  sys += `| RPG Maker codes | Preserve exactly: \\\\V[1], \\\\N[2], \\\\C[3], \\\\G, \\\\$, \\\\{, \\\\}, etc. |\n`;
  sys += `| HTML/XML tags | Keep tags intact; rewrite only text content. |\n`;
  sys += `| Line breaks | Preserve line break structure within each dialogue block. |\n`;
  sys += `| Existing ${targetLangName} text | Keep unchanged. |\n\n`;

  sys += `## Voice & Style\n\n`;
  sys += `| Rule | Directive |\n|------|----------|\n`;
  sys += `| Sentence rhythm | If the source accumulates meaning in long periods, do the same. If it cuts short, cut short. |\n`;
  sys += `| Pro-drop | Omit subjects when context is sufficient. Never open every sentence with he/she equivalents. |\n`;
  sys += `| Dialogue | 100% colloquial. Match character voice: formal/informal register by context. Natural contractions, fillers, idioms. |\n`;
  sys += `| Profanity | Natural ${targetLangName} equivalents preserving register and force of original. |\n`;
  sys += `| Tone matching | Read the source's emotional register and match it. Tense → fragmented, rapid. Romantic → lyrical, sensory. Comedy → snappy, fast. Peaceful → unhurried, spacious. |\n`;
  sys += `| Sensory detail | Use onomatopoeia and mimetic words actively when appropriate. |\n`;
  sys += `| Character voice | Reproduce speech patterns — archaic, rough, refined, childish — using equivalent ${targetLangName} registers. |\n\n`;

  sys += `## Anti-Translationese\n\n`;
  sys += `| Instead of (stiff literal) | Use (natural ${targetLangName}) |\n|---------------------------|-------------------------------|\n`;
  sys += `| Verbose cognitive constructions | Direct perception statements |\n`;
  sys += `| Formal connectives in dialogue | Colloquial conjunctions or omission |\n`;
  sys += `| Overused temporal markers | Concrete sensory descriptions |\n`;
  sys += `| Verbose sentence endings | Concise endings |\n\n`;

  sys += `## Authorial Intent Preservation\n\n`;
  sys += `The source text may contain deliberate inconsistencies, omissions, contradictions, or distortions as narrative devices. These are not errors. Do not correct, clarify, or normalize them. Rewrite them as they are — the reader is meant to encounter them intact.\n\n`;

  if (config.customPrompt.trim()) {
    sys += `## Additional Instructions\n\n${config.customPrompt.trim()}\n\n`;
  }

  sys += `## Output\n\n`;
  sys += `Output the rewritten ${targetLangName} text ONLY. No commentary, no explanations, no markdown code blocks, no meta-text.\n\n`;

  sys += `## Validation (Apply silently)\n\n`;
  sys += `Before output, verify:\n`;
  sys += `- Is every sentence of source accounted for?\n`;
  sys += `- Does the prose architecture match the source?\n`;
  sys += `- Is explicit/profane/sensitive content at original intensity?\n`;
  sys += `- Does the text read as native ${targetLangName} with zero translation artifacts?\n`;
  sys += `- Are all format elements (separators, RPG codes, tags) intact?`;

  return sys;
}

function buildUserMessage(text: string): string {
  return `<Source_Text>\n${text}\n</Source_Text>`;
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

function getVertexErrorMessage(error: unknown): string {
  const responseMessage = (error as {
    response?: {
      data?: {
        error?: {
          message?: unknown;
        };
      };
    };
  })?.response?.data?.error?.message;

  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage.trim();
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return String(error);
}

function getVertexErrorStatus(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function isVertexAuthError(error: unknown): boolean {
  const status = getVertexErrorStatus(error);
  const msg = getVertexErrorMessage(error).toLowerCase();

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
    return new Error(`Vertex AI authentication failed: ${getVertexErrorMessage(error)}`);
  }

  return error instanceof Error ? error : new Error(getVertexErrorMessage(error));
}

function isPermanentVertexError(error: unknown): boolean {
  return isPermanentApiError(error) || isVertexAuthError(error);
}

function isRetryableVertexError(error: unknown): boolean {
  return !isVertexAuthError(error) && isRetryableApiError(error);
}

function createFallbackValidation(chunk: TranslationBlock[], startIndex: number) {
  return {
    validatedBlocks: chunk.map((block) => ({ ...block })),
    blockValidations: chunk.map((block, idx) => ({
      index: startIndex + idx,
      separator: block.separator,
      originalLines: block.lines,
      translatedLines: block.lines,
      lineCountMatch: true,
      separatorMatch: true,
    })),
  };
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

export class VertexTranslator {
  private config: VertexConfig;
  private apiUrl: string;
  private httpClient: NonNullable<VertexDependencies['httpClient']>;
  private accessTokenProvider: () => Promise<string>;

  constructor(config: VertexConfig, deps: VertexDependencies = {}) {
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
            parts: [{ text: buildUserMessage(text) }],
          },
        ],
        systemInstruction: {
          role: 'system',
          parts: [{ text: buildSystemInstruction(this.config) }],
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

      let translated = candidates[0]?.content?.parts?.[0]?.text || '';
      translated = translated.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
      return translated.trim();
    } catch (error) {
      throw normalizeVertexError(error);
    }
  }

  async translateFileContent(
    content: string,
    onProgress?: (current: number, total: number, detail: string) => void,
  ): Promise<{ translatedContent: string; validation: BlockValidation[]; logEntry: Partial<TranslationLogEntry>; aborted?: boolean }> {
    const startTime = Date.now();
    const allBlocks = splitIntoBlocks(content);
    const isFileMode = this.config.translationUnit === 'file';
    const chunkSize = isFileMode ? allBlocks.length : this.config.chunkSize;
    const allValidations: BlockValidation[] = [];
    const allTranslatedBlocks = [];

    const logData = {
      totalBlocks: allBlocks.length,
      translatedBlocks: 0,
      skippedBlocks: 0,
      errorBlocks: 0,
      retries: 0,
      errors: [] as string[],
      durationMs: 0,
    };

    const chunks = [];
    for (let i = 0; i < allBlocks.length; i += chunkSize) {
      chunks.push(allBlocks.slice(i, i + chunkSize));
    }

    let processedBlocks = 0;
    for (let ci = 0; ci < chunks.length; ci++) {
      if (this.config.isAborted?.()) break;

      const chunk = chunks[ci];
      const chunkText = reassembleBlocks(chunk);

      if (onProgress) {
        onProgress(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length}`);
      }

      if (this.config.doNotTransHangul && hanguls.test(chunkText)) {
        for (const block of chunk) {
          allTranslatedBlocks.push({ ...block });
          allValidations.push({
            index: processedBlocks,
            separator: block.separator,
            originalLines: block.lines,
            translatedLines: block.lines,
            lineCountMatch: true,
            separatorMatch: true,
          });
          processedBlocks++;
          logData.skippedBlocks++;
        }
        if (onProgress) onProgress(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} (건너뜀)`);
        continue;
      }

      let validation = createFallbackValidation(chunk, processedBlocks);

      let retries = 0;
      let apiRetries = 0;
      let success = false;

      while (!success && retries <= this.config.maxRetries) {
        if (this.config.isAborted?.()) break;

        try {
          let translated = await this.translateText(chunkText);
          if (chunkText.endsWith('\n') && !translated.endsWith('\n')) {
            translated += '\n';
          }
          validation = validateChunk(chunk, translated);

          const hasError = validation.blockValidations.some((block) => !block.lineCountMatch || !block.separatorMatch);
          if (!hasError) {
            success = true;
            logData.translatedBlocks += chunk.length;
          } else if (retries < this.config.maxRetries) {
            retries++;
            logData.retries++;
          } else {
            logData.errorBlocks += validation.blockValidations.filter((block) => !block.lineCountMatch || !block.separatorMatch).length;
            logData.errors.push(`Chunk ${ci}: validation failed after ${this.config.maxRetries} retries`);
            success = true;
          }
        } catch (error) {
          const normalizedError = normalizeVertexError(error);

          if (isPermanentVertexError(normalizedError)) {
            logData.errors.push(`Chunk ${ci}: ${normalizedError.message.substring(0, 200)}`);
            validation = createFallbackValidation(chunk, processedBlocks);
            logData.skippedBlocks += chunk.length;
            success = true;
          } else if (isRetryableVertexError(normalizedError) && apiRetries < this.config.maxApiRetries) {
            apiRetries++;
            logData.retries++;
            const backoffMs = Math.min(API_BACKOFF_BASE_MS * Math.pow(2, apiRetries - 1), API_BACKOFF_MAX_MS);
            logData.errors.push(`Chunk ${ci}: API retry ${apiRetries} (${normalizedError.message.substring(0, 100)})`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          } else if (retries >= this.config.maxRetries) {
            logData.errors.push(`Chunk ${ci}: ${normalizedError.message.substring(0, 200)}`);
            validation = createFallbackValidation(chunk, processedBlocks);
            logData.skippedBlocks += chunk.length;
            success = true;
          } else {
            retries++;
            logData.retries++;
            const backoffMs = Math.min(VALIDATION_RETRY_BASE_MS * Math.pow(2, retries), VALIDATION_RETRY_MAX_MS);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }

      for (const block of validation.validatedBlocks) {
        allTranslatedBlocks.push(block);
      }
      for (const blockValidation of validation.blockValidations) {
        blockValidation.index = processedBlocks;
        allValidations.push(blockValidation);
        processedBlocks++;
      }

      if (onProgress) onProgress(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} 완료`);

      if (ci < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    logData.durationMs = Date.now() - startTime;

    return {
      translatedContent: reassembleBlocks(allTranslatedBlocks),
      validation: allValidations,
      logEntry: logData,
      aborted: !!this.config.isAborted?.(),
    };
  }
}

export function createVertexTranslator(
  settings: Record<string, any>,
  sourceLang: string,
  targetLang = 'ko',
  isAborted?: () => boolean,
  deps: VertexDependencies = {},
): VertexTranslator {
  const credentials = parseVertexServiceAccountJson(settings.llmVertexServiceAccountJson);

  return new VertexTranslator({
    credentials,
    model: settings.llmModel,
    customPrompt: settings.llmCustomPrompt,
    chunkSize: settings.llmChunkSize || 30,
    translationUnit: settings.llmTranslationUnit || 'file',
    sourceLang,
    targetLang,
    doNotTransHangul: settings.DoNotTransHangul,
    maxRetries: settings.llmMaxRetries ?? 2,
    maxApiRetries: settings.llmMaxApiRetries ?? 5,
    timeout: (settings.llmTimeout || DEFAULT_API_TIMEOUT_SEC) * 1000,
    location: normalizeVertexLocation(settings.llmVertexLocation || DEFAULT_LLM_VERTEX_LOCATION),
    isAborted,
  }, deps);
}
