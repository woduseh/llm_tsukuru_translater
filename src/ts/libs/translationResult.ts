import type { BlockValidation, TranslationLogEntry } from './translationCore';
import { compareTranslationLineStructure } from './translationSyntax';

export type TranslationRunLog = Omit<TranslationLogEntry, 'timestamp' | 'fileName' | 'cached'>;

interface TranslationDiagnostics {
  validation: BlockValidation[];
  logEntry: TranslationRunLog;
}

/** Failed/cancelled work has no savable content. Callers only decide where to store a success. */
export type TranslationOutcome = TranslationDiagnostics & (
  | { status: 'translated' | 'skipped'; translatedContent: string }
  | { status: 'failed'; error: string }
  | { status: 'aborted' }
);

export interface FileValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateTranslatedFileContent(
  originalContent: string,
  translatedContent: string,
  blockValidation: BlockValidation[] = [],
): FileValidationResult {
  const errors: string[] = [];
  const originalLines = originalContent.split('\n');
  const translatedLines = translatedContent.split('\n');
  if (originalLines.length !== translatedLines.length) {
    errors.push(`line count changed (${originalLines.length} -> ${translatedLines.length})`);
  }
  for (let i = 0; i < Math.max(originalLines.length, translatedLines.length); i++) {
    const originalLine = originalLines[i] ?? '';
    const changes = compareTranslationLineStructure(originalLine, translatedLines[i] ?? '');
    if (changes.separatorChanged) errors.push(`separator changed at line ${i + 1}`);
    if (changes.emptyLineChanged) {
      errors.push(`${originalLine === '' ? 'empty line filled' : 'non-empty line emptied'} at line ${i + 1}`);
    }
    if (changes.controlCodesChanged) errors.push(`control codes changed at line ${i + 1}`);
  }
  const failedBlocks = blockValidation.filter(block => !block.lineCountMatch || !block.separatorMatch);
  if (failedBlocks.length) errors.push(`block validation failed (${failedBlocks.length} blocks)`);
  return { ok: errors.length === 0, errors };
}

/** Producer-side completion: provider failure, cancellation and structural rules are resolved here. */
export function finishFileTranslation(
  originalContent: string,
  translatedContent: string,
  diagnostics: TranslationDiagnostics,
  execution: { aborted?: boolean; incomplete?: boolean } = {},
): TranslationOutcome {
  if (execution.aborted) return { ...diagnostics, status: 'aborted' };
  if (execution.incomplete || diagnostics.logEntry.errorBlocks > 0) {
    return {
      ...diagnostics, status: 'failed',
      error: diagnostics.logEntry.errors[0] || '제공자 오류로 일부 청크가 번역되지 않았습니다',
    };
  }
  const validation = validateTranslatedFileContent(originalContent, translatedContent, diagnostics.validation);
  if (!validation.ok) return { ...diagnostics, status: 'failed', error: validation.errors[0] };
  const intentionallySkippedAll = diagnostics.logEntry.totalBlocks > 0
    && diagnostics.logEntry.skippedBlocks === diagnostics.logEntry.totalBlocks;
  if (translatedContent === originalContent && !intentionallySkippedAll) {
    return { ...diagnostics, status: 'failed', error: '번역 결과가 원본과 동일합니다' };
  }
  return { ...diagnostics, status: intentionallySkippedAll ? 'skipped' : 'translated', translatedContent };
}
