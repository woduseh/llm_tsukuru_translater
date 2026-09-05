import { hanguls } from '../rpgmv/datas';
import type { AppSettings } from '../../types/settings';
import {
  API_BACKOFF_BASE_MS,
  API_BACKOFF_MAX_MS,
  DEFAULT_API_TIMEOUT_SEC,
  VALIDATION_RETRY_BASE_MS,
  VALIDATION_RETRY_MAX_MS,
} from './constants';
import {
  reassembleBlocks,
  splitIntoBlocks,
  validateChunk,
  isPermanentApiError,
  isRetryableApiError,
  type BlockValidation,
  type TranslationBlock,
  type TranslationLogEntry,
} from './translationCore';
import { getProviderErrorStatus, getRetryAfterMs } from './providerRetry';
import { TranslationAbortedError, TranslationRequestScheduler } from './translationRequestScheduler';

export interface ProviderTranslationConfig {
  chunkSize: number;
  translationUnit: string;
  doNotTransHangul: boolean;
  maxRetries: number;
  maxApiRetries: number;
  requestConcurrency?: number;
  requestsPerMinute?: number;
  isAborted?: () => boolean;
  isPermanentError?: (error: unknown) => boolean;
  isRetryableError?: (error: unknown) => boolean;
}

export interface ProviderTranslatorConfig extends ProviderTranslationConfig {
  model: string;
  customPrompt: string;
  sourceLang: string;
  targetLang: string;
  timeout: number;
}

export function createProviderTranslatorConfig(
  settings: Partial<AppSettings>,
  sourceLang: string,
  targetLang: string,
  isAborted?: () => boolean,
): ProviderTranslatorConfig {
  return {
    model: settings.llmModel || '',
    customPrompt: settings.llmCustomPrompt || '',
    chunkSize: settings.llmChunkSize || 30,
    translationUnit: settings.llmTranslationUnit || 'file',
    sourceLang,
    targetLang,
    doNotTransHangul: !!settings.DoNotTransHangul,
    maxRetries: settings.llmMaxRetries ?? 2,
    maxApiRetries: settings.llmMaxApiRetries ?? 5,
    requestConcurrency: settings.llmParallelWorkers,
    requestsPerMinute: settings.llmRequestsPerMinute,
    timeout: (settings.llmTimeout || DEFAULT_API_TIMEOUT_SEC) * 1000,
    isAborted,
  };
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

export function createTranslationChunks(
  allBlocks: TranslationBlock[],
  chunkSize: number,
  doNotTransHangul: boolean,
): TranslationBlock[][] {
  const chunks: TranslationBlock[][] = [];
  for (let i = 0; i < allBlocks.length; i += chunkSize) {
    const baseChunk = allBlocks.slice(i, i + chunkSize);
    if (!doNotTransHangul || baseChunk.length < 2) {
      chunks.push(baseChunk);
      continue;
    }

    let current: TranslationBlock[] = [];
    let currentShouldSkip: boolean | undefined;
    for (const block of baseChunk) {
      const shouldSkip = blockContainsHangul(block);
      if (current.length > 0 && shouldSkip !== currentShouldSkip) {
        chunks.push(current);
        current = [];
      }
      current.push(block);
      currentShouldSkip = shouldSkip;
    }
    if (current.length > 0) chunks.push(current);
  }
  return chunks;
}

function blockContainsHangul(block: TranslationBlock): boolean {
  return hanguls.test(block.separator) || block.lines.some((line) => hanguls.test(line));
}

function isRateLimitError(error: unknown): boolean {
  return getProviderErrorStatus(error) === 429
    || /429|resource_exhausted|rate limit|quota/i.test(error instanceof Error ? error.message : String(error));
}

function apiRetryDelay(error: unknown, attempt: number): number {
  const backoff = Math.min(API_BACKOFF_BASE_MS * Math.pow(2, attempt), API_BACKOFF_MAX_MS);
  return Math.max(getRetryAfterMs(error) ?? 0, Math.min(API_BACKOFF_MAX_MS, backoff * (1 + Math.random() * 0.25)));
}

export interface TranslationExecution {
  scheduler: TranslationRequestScheduler;
}

export abstract class ProviderTranslationBase {
  protected constructor(protected readonly baseConfig: ProviderTranslationConfig) {}

  abstract translateText(text: string): Promise<string>;

  async translateFileContent(
    content: string,
    onProgress?: (current: number, total: number, detail: string) => void,
    execution?: TranslationExecution,
  ): Promise<{
    translatedContent: string;
    validation: BlockValidation[];
    logEntry: Partial<TranslationLogEntry>;
    aborted?: boolean;
    incomplete?: boolean;
  }> {
    const startTime = Date.now();
    const allBlocks = splitIntoBlocks(content);
    const isFileMode = this.baseConfig.translationUnit === 'file';
    const chunkSize = Math.max(1, isFileMode ? allBlocks.length : this.baseConfig.chunkSize);
    const scheduler = execution?.scheduler ?? new TranslationRequestScheduler({
      concurrency: this.baseConfig.requestConcurrency,
      requestsPerMinute: this.baseConfig.requestsPerMinute,
      isAborted: this.baseConfig.isAborted,
    });
    const isAborted = () => scheduler.isAborted() || !!this.baseConfig.isAborted?.();
    const logData = {
      totalBlocks: allBlocks.length,
      translatedBlocks: 0,
      skippedBlocks: 0,
      errorBlocks: 0,
      retries: 0,
      errors: [] as string[],
      durationMs: 0,
    };

    const chunks = createTranslationChunks(allBlocks, chunkSize, this.baseConfig.doNotTransHangul);
    let offset = 0;
    const results = chunks.map((chunk) => {
      const result = { startIndex: offset, validation: createFallbackValidation(chunk, offset) };
      offset += chunk.length;
      return result;
    });
    let processedBlocks = 0;
    let incomplete = false;
    const translateChunk = async (ci: number) => {
      const chunk = chunks[ci];
      const startIndex = results[ci].startIndex;
      onProgress?.(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length}`);

      if (this.baseConfig.doNotTransHangul && chunk.some(blockContainsHangul)) {
        processedBlocks += chunk.length;
        logData.skippedBlocks += chunk.length;
        onProgress?.(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} (건너뜀)`);
        return;
      }

      const chunkText = reassembleBlocks(chunk);
      let validation = results[ci].validation;
      let retries = 0;
      let apiRetries = 0;
      let success = false;

      while (!success && retries <= this.baseConfig.maxRetries) {
        if (isAborted()) break;
        try {
          let translated = await scheduler.run(async () => {
            if (isAborted()) throw new TranslationAbortedError();
            try {
              return await this.translateText(chunkText);
            } catch (error) {
              // Apply the shared cooldown before releasing this request's permit.
              if (isRateLimitError(error)) scheduler.pauseFor(apiRetryDelay(error, apiRetries));
              throw error;
            }
          });
          if (isAborted()) break;
          if (chunkText.endsWith('\n') && !translated.endsWith('\n')) translated += '\n';
          validation = validateChunk(chunk, translated);
          const hasError = validation.blockValidations.some((block) => !block.lineCountMatch || !block.separatorMatch);
          if (!hasError) {
            success = true;
            logData.translatedBlocks += chunk.length;
          } else if (retries < this.baseConfig.maxRetries) {
            retries++;
            logData.retries++;
          } else {
            logData.errorBlocks += validation.blockValidations.filter((block) => !block.lineCountMatch || !block.separatorMatch).length;
            logData.errors.push(`Chunk ${ci}: validation failed after ${this.baseConfig.maxRetries} retries`);
            incomplete = true;
            success = true;
          }
        } catch (error) {
          if (error instanceof TranslationAbortedError || isAborted()) break;
          const message = error instanceof Error ? error.message : String(error);
          const permanentError = this.baseConfig.isPermanentError?.(error) ?? isPermanentApiError(error);
          const retryableError = this.baseConfig.isRetryableError?.(error) ?? isRetryableApiError(error);
          if (permanentError || (retryableError && apiRetries >= this.baseConfig.maxApiRetries)) {
            logData.errors.push(`Chunk ${ci}: ${message.substring(0, 200)}`);
            validation = createFallbackValidation(chunk, startIndex);
            logData.errorBlocks += chunk.length;
            incomplete = true;
            success = true;
          } else if (retryableError && apiRetries < this.baseConfig.maxApiRetries) {
            apiRetries++;
            logData.retries++;
            logData.errors.push(`Chunk ${ci}: API retry ${apiRetries} (${message.substring(0, 100)})`);
            if (!isRateLimitError(error)) await scheduler.wait(apiRetryDelay(error, apiRetries - 1));
          } else if (retries >= this.baseConfig.maxRetries) {
            logData.errors.push(`Chunk ${ci}: ${message.substring(0, 200)}`);
            validation = createFallbackValidation(chunk, startIndex);
            logData.errorBlocks += chunk.length;
            incomplete = true;
            success = true;
          } else {
            retries++;
            logData.retries++;
            const backoffMs = Math.min(VALIDATION_RETRY_BASE_MS * Math.pow(2, retries), VALIDATION_RETRY_MAX_MS);
            await scheduler.wait(backoffMs);
          }
        }
      }

      if (isAborted()) return;
      validation.blockValidations.forEach((block, index) => { block.index = startIndex + index; });
      results[ci].validation = validation;
      processedBlocks += chunk.length;
      onProgress?.(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} 완료`);
    };

    let nextChunk = 0;
    let failure: { error: unknown } | undefined;
    const worker = async () => {
      try {
        while (nextChunk < chunks.length && !isAborted() && !failure) {
          await translateChunk(nextChunk++);
        }
      } catch (error) {
        if (error instanceof TranslationAbortedError) return;
        failure ??= { error };
        scheduler.cancel();
      }
    };
    // Only a bounded number of chunks can wait for permits. Drain every worker
    // before returning so cancellation/callback failure cannot outlive a file lock.
    await Promise.all(Array.from({ length: Math.min(scheduler.concurrency, chunks.length) }, worker));
    if (failure) throw failure.error;

    logData.durationMs = Date.now() - startTime;
    return {
      translatedContent: isAborted() ? content : reassembleBlocks(results.flatMap((result) => result.validation.validatedBlocks)),
      validation: results.flatMap((result) => result.validation.blockValidations),
      logEntry: logData,
      aborted: isAborted(),
      incomplete,
    };
  }
}
