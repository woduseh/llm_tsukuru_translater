import { validateTranslatedFileContent } from './translator';

const SEPARATOR_LINE_REGEX = /^---\s*\d+\s*---$/;

export interface VersionUpMigrationResult {
  content: string;
  replacements: number;
  dictionaryEntries: number;
  ambiguousSourceLines: string[];
}

interface TextLayout {
  bom: string;
  lines: string[];
  endings: string[];
}

/**
 * Carries safe, exact old-version translations into newly extracted text.
 * Ambiguous duplicate source lines are deliberately skipped instead of
 * guessing which context-specific translation belongs in the new version.
 */
export function migrateVersionText(
  oldOriginalContent: string,
  oldTranslatedContent: string,
  newOriginalContent: string,
): VersionUpMigrationResult {
  const oldOriginal = parseTextLayout(oldOriginalContent);
  const oldTranslated = parseTextLayout(oldTranslatedContent);
  const newOriginal = parseTextLayout(newOriginalContent);

  const oldValidation = validateTranslatedFileContent(
    oldOriginal.lines.join('\n'),
    oldTranslated.lines.join('\n'),
  );
  if (!oldValidation.ok) {
    throw new Error(`구버전 번역본 구조가 원본과 일치하지 않습니다: ${oldValidation.errors.join(', ')}`);
  }

  const candidates = new Map<string, Set<string>>();
  for (let index = 0; index < oldOriginal.lines.length; index++) {
    const source = oldOriginal.lines[index];
    const translated = oldTranslated.lines[index];
    if (source === translated || !source || SEPARATOR_LINE_REGEX.test(source.trim())) continue;

    const translations = candidates.get(source) ?? new Set<string>();
    translations.add(translated);
    candidates.set(source, translations);
  }

  const dictionary = new Map<string, string>();
  const ambiguousSourceLines: string[] = [];
  for (const [source, translations] of candidates) {
    if (translations.size === 1) {
      dictionary.set(source, translations.values().next().value as string);
    } else {
      ambiguousSourceLines.push(source);
    }
  }

  let replacements = 0;
  const migratedLines = newOriginal.lines.map((line) => {
    const translated = dictionary.get(line);
    if (translated === undefined) return line;
    replacements++;
    return translated;
  });

  const migratedNormalized = migratedLines.join('\n');
  const newValidation = validateTranslatedFileContent(newOriginal.lines.join('\n'), migratedNormalized);
  if (!newValidation.ok) {
    throw new Error(`신버전 이식 결과가 구조 검증에 실패했습니다: ${newValidation.errors.join(', ')}`);
  }

  return {
    content: renderTextLayout({ ...newOriginal, lines: migratedLines }),
    replacements,
    dictionaryEntries: dictionary.size,
    ambiguousSourceLines,
  };
}

function parseTextLayout(content: string): TextLayout {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? content.slice(1) : content;
  return {
    bom,
    lines: body.split(/\r\n|\n/),
    endings: body.match(/\r\n|\n/g) ?? [],
  };
}

function renderTextLayout(layout: TextLayout): string {
  let output = layout.bom;
  for (let index = 0; index < layout.lines.length; index++) {
    output += layout.lines[index];
    if (index < layout.endings.length) output += layout.endings[index];
  }
  return output;
}
