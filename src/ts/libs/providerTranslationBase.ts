import { hanguls } from '../rpgmv/datas';
import {
  API_BACKOFF_BASE_MS,
  API_BACKOFF_MAX_MS,
  RATE_LIMIT_DELAY_MS,
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

export interface ProviderTranslationConfig {
  chunkSize: number;
  translationUnit: string;
  doNotTransHangul: boolean;
  maxRetries: number;
  maxApiRetries: number;
  isAborted?: () => boolean;
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

export abstract class ProviderTranslationBase {
  protected constructor(protected readonly baseConfig: ProviderTranslationConfig) {}

  abstract translateText(text: string): Promise<string>;

  async translateFileContent(
    content: string,
    onProgress?: (current: number, total: number, detail: string) => void,
  ): Promise<{ translatedContent: string; validation: BlockValidation[]; logEntry: Partial<TranslationLogEntry>; aborted?: boolean }> {
    const startTime = Date.now();
    const allBlocks = splitIntoBlocks(content);
    const isFileMode = this.baseConfig.translationUnit === 'file';
    const chunkSize = Math.max(1, isFileMode ? allBlocks.length : this.baseConfig.chunkSize);
    const allValidations: BlockValidation[] = [];
    const allTranslatedBlocks: TranslationBlock[] = [];
    const logData = {
      totalBlocks: allBlocks.length,
      translatedBlocks: 0,
      skippedBlocks: 0,
      errorBlocks: 0,
      retries: 0,
      errors: [] as string[],
      durationMs: 0,
    };

    const chunks: TranslationBlock[][] = [];
    for (let i = 0; i < allBlocks.length; i += chunkSize) {
      chunks.push(allBlocks.slice(i, i + chunkSize));
    }

    let processedBlocks = 0;
    for (let ci = 0; ci < chunks.length; ci++) {
      if (this.baseConfig.isAborted?.()) break;

      const chunk = chunks[ci];
      const chunkText = reassembleBlocks(chunk);
      onProgress?.(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length}`);

      if (this.baseConfig.doNotTransHangul && hanguls.test(chunkText)) {
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
        onProgress?.(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} (건너뜀)`);
        continue;
      }

      let validation = createFallbackValidation(chunk, processedBlocks);
      let retries = 0;
      let apiRetries = 0;
      let success = false;

      while (!success && retries <= this.baseConfig.maxRetries) {
        if (this.baseConfig.isAborted?.()) break;
        try {
          let translated = await this.translateText(chunkText);
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
            success = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isPermanentApiError(error)) {
            logData.errors.push(`Chunk ${ci}: ${message.substring(0, 200)}`);
            validation = createFallbackValidation(chunk, processedBlocks);
            logData.skippedBlocks += chunk.length;
            success = true;
          } else if (isRetryableApiError(error) && apiRetries < this.baseConfig.maxApiRetries) {
            apiRetries++;
            logData.retries++;
            const backoffMs = Math.min(API_BACKOFF_BASE_MS * Math.pow(2, apiRetries - 1), API_BACKOFF_MAX_MS);
            logData.errors.push(`Chunk ${ci}: API retry ${apiRetries} (${message.substring(0, 100)})`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          } else if (retries >= this.baseConfig.maxRetries) {
            logData.errors.push(`Chunk ${ci}: ${message.substring(0, 200)}`);
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

      allTranslatedBlocks.push(...validation.validatedBlocks);
      for (const blockValidation of validation.blockValidations) {
        blockValidation.index = processedBlocks;
        allValidations.push(blockValidation);
        processedBlocks++;
      }
      onProgress?.(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} 완료`);
      if (ci < chunks.length - 1) await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    logData.durationMs = Date.now() - startTime;
    return {
      translatedContent: reassembleBlocks(allTranslatedBlocks),
      validation: allValidations,
      logEntry: logData,
      aborted: !!this.baseConfig.isAborted?.(),
    };
  }
}
