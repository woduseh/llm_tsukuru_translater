import type { BlockValidation, TranslationLogEntry } from './translationCore';
import type { ControlCodePolicy } from '../../types/settings';
import { extractTranslationControlCodes, compareTranslationLineStructure } from './translationSyntax';

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
  warnings: string[];
}

export function validateTranslatedFileContent(
  originalContent: string,
  translatedContent: string,
  blockValidation: BlockValidation[] = [],
  controlCodePolicy: ControlCodePolicy = 'strict',
): FileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
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
    if (changes.controlCodesChanged) {
      const message = `control codes changed at line ${i + 1}: original=${JSON.stringify(extractTranslationControlCodes(originalLine))}, translated=${JSON.stringify(extractTranslationControlCodes(translatedLines[i] ?? ''))}`;
      (controlCodePolicy === 'warn' ? warnings : errors).push(message);
    }
  }
  const failedBlocks = blockValidation.filter(block => !block.lineCountMatch || !block.separatorMatch);
  if (failedBlocks.length) errors.push(`block validation failed (${failedBlocks.length} blocks)`);
  return { ok: errors.length === 0, errors, warnings };
}

/** Producer-side completion: provider failure, cancellation and structural rules are resolved here. */
export function finishFileTranslation(
  originalContent: string,
  translatedContent: string,
  diagnostics: TranslationDiagnostics,
  execution: { aborted?: boolean; incomplete?: boolean; controlCodePolicy?: ControlCodePolicy } = {},
): TranslationOutcome {
  if (execution.aborted) return { ...diagnostics, status: 'aborted' };
  if (execution.incomplete || diagnostics.logEntry.errorBlocks > 0) {
    return {
      ...diagnostics, status: 'failed',
      error: diagnostics.logEntry.errors[0] || '제공자 오류로 일부 청크가 번역되지 않았습니다',
    };
  }
  const validation = validateTranslatedFileContent(originalContent, translatedContent, diagnostics.validation, execution.controlCodePolicy ?? 'warn');
  diagnostics = {
    ...diagnostics,
    logEntry: {
      ...diagnostics.logEntry,
      ...(validation.warnings.length ? { warnings: validation.warnings } : {}),
      errors: [...diagnostics.logEntry.errors, ...validation.errors],
    },
  };
  if (!validation.ok) return { ...diagnostics, status: 'failed', error: validation.errors[0] };
  const intentionallySkippedAll = diagnostics.logEntry.totalBlocks > 0
    && diagnostics.logEntry.skippedBlocks === diagnostics.logEntry.totalBlocks;
  if (translatedContent === originalContent && !intentionallySkippedAll) {
    return { ...diagnostics, status: 'failed', error: '번역 결과가 원본과 동일합니다' };
  }
  return { ...diagnostics, status: intentionallySkippedAll ? 'skipped' : 'translated', translatedContent };
}
