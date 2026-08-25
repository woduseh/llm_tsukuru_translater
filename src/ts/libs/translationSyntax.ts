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

export function haveSameTranslationLineStructure(
  originalLines: readonly string[],
  translatedLines: readonly string[],
): boolean {
  if (originalLines.length !== translatedLines.length) return false;
  return originalLines.every((originalLine, index) => {
    const translatedLine = translatedLines[index];
    if ((originalLine === '') !== (translatedLine === '')) return false;
    const originalCodes = extractTranslationControlCodes(originalLine);
    const translatedCodes = extractTranslationControlCodes(translatedLine);
    return originalCodes.length === translatedCodes.length
      && originalCodes.every((code, codeIndex) => code === translatedCodes[codeIndex]);
  });
}
