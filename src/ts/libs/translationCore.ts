import * as crypto from 'crypto';
import { isSeparatorLine } from './translationSyntax';
import { copyRetryMetadata, getProviderErrorStatus } from './providerRetry';

export { isSeparatorLine, SEPARATOR_REGEX } from './translationSyntax';

export interface TranslationBlock {
  separator: string;
  lines: string[];
}

export interface BlockValidation {
  index: number;
  separator: string;
  originalLines: string[];
  translatedLines: string[];
  lineCountMatch: boolean;
  separatorMatch: boolean;
}

export interface TranslationLogEntry {
  timestamp: string;
  fileName: string;
  totalBlocks: number;
  translatedBlocks: number;
  skippedBlocks: number;
  errorBlocks: number;
  retries: number;
  cached: boolean;
  durationMs: number;
  errors: string[];
}

export interface TranslationLog {
  startTime: string;
  endTime: string;
  provider: string;
  model: string;
  sourceLang: string;
  targetLang: string;
  totalFiles: number;
  totalDurationMs: number;
  entries: TranslationLogEntry[];
}

export function splitIntoBlocks(content: string): TranslationBlock[] {
  return splitFileBlocks(content.split('\n'));
}

export function splitFileBlocks(allLines: readonly string[]): TranslationBlock[] {
  const blocks: TranslationBlock[] = [];
  let currentSep = '';
  let currentLines: string[] = [];

  for (const line of allLines) {
    if (isSeparatorLine(line)) {
      if (currentSep !== '' || currentLines.length > 0) {
        blocks.push({ separator: currentSep, lines: currentLines });
      }
      currentSep = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentSep !== '' || currentLines.length > 0) {
    blocks.push({ separator: currentSep, lines: currentLines });
  }

  return blocks;
}

export function reassembleBlocks(blocks: TranslationBlock[]): string {
  let lineCount = 0;
  for (const block of blocks) {
    lineCount += block.lines.length + (block.separator ? 1 : 0);
  }
  // Allocate once and avoid spreading large blocks as function arguments.
  const parts = new Array<string>(lineCount);
  let index = 0;
  for (const block of blocks) {
    if (block.separator) {
      parts[index++] = block.separator;
    }
    for (const line of block.lines) {
      parts[index++] = line;
    }
  }
  return parts.join('\n');
}

export function validateChunk(
  originalBlocks: TranslationBlock[],
  translatedText: string,
): { validatedBlocks: TranslationBlock[]; blockValidations: BlockValidation[] } {
  const translatedBlocks = splitIntoBlocks(translatedText);
  const blockValidations: BlockValidation[] = [];
  const validatedBlocks: TranslationBlock[] = [];

  for (let i = 0; i < originalBlocks.length; i++) {
    const origBlock = originalBlocks[i];
    const transBlock = translatedBlocks[i];

    if (!transBlock) {
      blockValidations.push({
        index: i,
        separator: origBlock.separator,
        originalLines: origBlock.lines,
        translatedLines: origBlock.lines,
        lineCountMatch: false,
        separatorMatch: false,
      });
      validatedBlocks.push({ ...origBlock });
      continue;
    }

    const sepMatch = origBlock.separator === transBlock.separator;
    const lineMatch = origBlock.lines.length === transBlock.lines.length;

    blockValidations.push({
      index: i,
      separator: origBlock.separator,
      originalLines: origBlock.lines,
      translatedLines: transBlock.lines,
      lineCountMatch: lineMatch,
      separatorMatch: origBlock.separator === '' || sepMatch,
    });

    validatedBlocks.push({
      separator: origBlock.separator,
      lines: transBlock.lines,
    });
  }

  if (translatedBlocks.length > originalBlocks.length) {
    for (let i = originalBlocks.length; i < translatedBlocks.length; i++) {
      blockValidations.push({
        index: i,
        separator: translatedBlocks[i].separator,
        originalLines: [],
        translatedLines: translatedBlocks[i].lines,
        lineCountMatch: false,
        separatorMatch: false,
      });
    }
  }

  return { validatedBlocks, blockValidations };
}

export function getApiErrorMessage(error: unknown): string {
  const apiMessage = (error as { response?: { data?: { error?: { message?: unknown } } } })?.response?.data?.error?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error);
}

export function getApiErrorStatus(error: unknown): number | undefined {
  return getProviderErrorStatus(error);
}

export function normalizeProviderApiError(error: unknown, provider: string, secret?: string): Error {
  if (error instanceof Error && error.message.startsWith(`${provider} API `)) return error;
  const status = getApiErrorStatus(error);
  const rawMessage = getApiErrorMessage(error);
  const message = secret?.trim() ? rawMessage.split(secret).join('[REDACTED]') : rawMessage;
  const reason = status === 401 || status === 403 ? 'authentication failed'
    : status === 429 ? 'rate limit (429)'
      : (error as { code?: unknown })?.code === 'ECONNABORTED' ? 'timeout'
        : 'error';
  return copyRetryMetadata(error, new Error(`${provider} API ${reason}: ${message}`));
}

export function isPermanentApiError(error: unknown): boolean {
  if (!error) return false;
  const msg = String((error as Record<string, unknown>).message || error).toLowerCase();
  const code = String((error as Record<string, unknown>).code || '').toLowerCase();
  return msg.includes('blocked') || msg.includes('timeout') || code === 'econnaborted';
}

export function isRetryableApiError(error: unknown): boolean {
  if (!error) return false;
  const status = getApiErrorStatus(error);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String((error as Record<string, unknown>).message || error).toLowerCase();
  return msg.includes('429') || msg.includes('503') || msg.includes('resource_exhausted')
    || msg.includes('rate limit') || msg.includes('quota') || msg.includes('overloaded')
    || msg.includes('internal') || msg.includes('unavailable') || msg.includes('deadline')
    || msg.includes('no candidates');
}

export function contentHash(content: string): string {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}
