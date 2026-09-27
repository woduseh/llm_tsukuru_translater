// MV/MZ uses numeric separators (for example `--- 101 ---`) while Wolf
// appends a command index (for example `--- 101-0 ---`). Keep the accepted
// token deliberately narrow so ordinary prose wrapped in dashes is not
// mistaken for structural metadata.
export const SEPARATOR_REGEX = /^---\s*\d+(?:-\d+)?\s*---$/;

export function isSeparatorLine(line: string): boolean {
  return SEPARATOR_REGEX.test(line.trim());
}

/** Files in an extracted translation surface that must stay line-aligned. */
export function isTranslationTextFileName(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return normalized.endsWith('.txt') || normalized === 'ext_javascript.js';
}

const TRANSLATION_CONTROL_CODE_REGEX = /\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[{}$|.!><^])|%[0-9]/g;

export function extractTranslationControlCodes(line: string): string[] {
  return line.match(TRANSLATION_CONTROL_CODE_REGEX) || [];
}

/** Structural checks shared by translation, review, QA and approved patches. */
export function compareTranslationLineStructure(before: string, after: string) {
  const beforeCodes = extractTranslationControlCodes(before);
  const afterCodes = extractTranslationControlCodes(after);
  return {
    emptyLineChanged: (before === '') !== (after === ''),
    separatorChanged: (isSeparatorLine(before) || isSeparatorLine(after)) && before !== after,
    controlCodesChanged: beforeCodes.length !== afterCodes.length
      || beforeCodes.some((code, index) => code !== afterCodes[index]),
  };
}

export function haveSameTranslationLineStructure(
  originalLines: readonly string[],
  translatedLines: readonly string[],
): boolean {
  if (originalLines.length !== translatedLines.length) return false;
  return originalLines.every((line, index) => {
    const changes = compareTranslationLineStructure(line, translatedLines[index]);
    return !changes.emptyLineChanged && !changes.separatorChanged && !changes.controlCodesChanged;
  });
}
