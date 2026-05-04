import * as fs from 'fs';
import * as path from 'path';
import { rmBom } from './fileIO';

export interface ProjectProfileScanOptions {
  maxFiles?: number;
  maxDirectoryEntries?: number;
  maxFileBytes?: number;
  maxJsonBytes?: number;
  maxTextBytes?: number;
  maxSamplesPerBucket?: number;
  maxSampleLength?: number;
  maxRepeatedPhrases?: number;
  maxTerms?: number;
  maxCandidates?: number;
  minRepeatedPhraseCount?: number;
}

export interface ProjectProfileFileStats {
  totalFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  byExtension: Record<string, number>;
  byKind: Record<ProjectProfileFileKind, number>;
  largestFiles: Array<{ path: string; bytes: number; kind: ProjectProfileFileKind }>;
}

export type ProjectProfileFileKind = 'rpg-maker-json' | 'wolf-data' | 'extracted-text' | 'csv' | 'other';

export interface ProjectProfileSample {
  text: string;
  count: number;
  files: string[];
}

export interface ProjectProfilePattern {
  pattern: string;
  count: number;
  files: string[];
  examples: string[];
}

export interface ProjectTranslationProfile {
  schemaVersion: 1;
  scanner: 'projectProfile';
  rootName: string;
  limits: Required<ProjectProfileScanOptions>;
  fileStats: ProjectProfileFileStats;
  languageHints: Record<'hangul' | 'hiragana' | 'katakana' | 'kanji' | 'latin', number>;
  terms: ProjectProfileSample[];
  names: ProjectProfileSample[];
  repeatedPhrases: ProjectProfileSample[];
  characterCandidates: ProjectProfileSample[];
  controlCodePatterns: ProjectProfilePattern[];
  separatorPatterns: ProjectProfilePattern[];
  warnings: string[];
}

interface MutableSample {
  text: string;
  count: number;
  files: Set<string>;
}

interface MutablePattern {
  pattern: string;
  count: number;
  files: Set<string>;
  examples: string[];
}

const DEFAULT_LIMITS: Required<ProjectProfileScanOptions> = {
  maxFiles: 300,
  maxDirectoryEntries: 5000,
  maxFileBytes: 2 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  maxTextBytes: 256 * 1024,
  maxSamplesPerBucket: 40,
  maxSampleLength: 80,
  maxRepeatedPhrases: 40,
  maxTerms: 80,
  maxCandidates: 60,
  minRepeatedPhraseCount: 2,
};

const MAX_WARNINGS = 40;
const MAX_LARGEST_FILES = 20;
const JSON_NAME_KEYS = new Set(['name', 'nickname', 'displayName', 'characterName']);
const JSON_TEXT_KEYS = new Set(['message', 'text', 'note', 'description', 'profile']);
const WOLF_EXTENSIONS = new Set(['.wolf', '.mps', '.dat', '.project']);
const TEXT_EXTENSIONS = new Set(['.txt']);
const CSV_EXTENSIONS = new Set(['.csv']);

const CONTROL_CODE_REGEX = /\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g;
const SEPARATOR_REGEX = /^-{3,}\s*[^-\r\n]{1,80}\s*-{3,}$/;
const TOKEN_REGEX = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z][\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9_'’・ー-]{1,39}/gu;

export function scanProjectTranslationProfile(rootDir: string, options: ProjectProfileScanOptions = {}): ProjectTranslationProfile {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const absoluteRoot = path.resolve(rootDir);
  const warnings: string[] = [];
  const stats: ProjectProfileFileStats = {
    totalFiles: 0,
    scannedFiles: 0,
    skippedFiles: 0,
    totalBytes: 0,
    byExtension: {},
    byKind: {
      'rpg-maker-json': 0,
      'wolf-data': 0,
      'extracted-text': 0,
      csv: 0,
      other: 0,
    },
    largestFiles: [],
  };
  const languageHints = { hangul: 0, hiragana: 0, katakana: 0, kanji: 0, latin: 0 };
  const terms = new Map<string, MutableSample>();
  const names = new Map<string, MutableSample>();
  const phrases = new Map<string, MutableSample>();
  const candidates = new Map<string, MutableSample>();
  const controlPatterns = new Map<string, MutablePattern>();
  const separatorPatterns = new Map<string, MutablePattern>();

  const files = collectCandidateFiles(absoluteRoot, limits, warnings);
  for (const filePath of files) {
    const relPath = normalizeRelativePath(absoluteRoot, filePath);
    const stat = statFile(filePath, relPath);
    const extension = path.extname(filePath).toLowerCase();
    const kind = classifyFile(filePath);

    stats.totalFiles += 1;
    stats.totalBytes += stat.size;
    stats.byExtension[extension || '<none>'] = (stats.byExtension[extension || '<none>'] ?? 0) + 1;
    stats.byKind[kind] += 1;
    addLargestFile(stats, { path: relPath, bytes: stat.size, kind });

    if (stats.scannedFiles >= limits.maxFiles) {
      stats.skippedFiles += 1;
      addWarning(warnings, `Skipped ${relPath}: maxFiles limit reached (${limits.maxFiles}).`);
      continue;
    }
    if (stat.size > limits.maxFileBytes) {
      stats.skippedFiles += 1;
      addWarning(warnings, `Skipped ${relPath}: ${stat.size} bytes exceeds maxFileBytes ${limits.maxFileBytes}.`);
      continue;
    }

    if (kind === 'rpg-maker-json') {
      scanJsonFile(filePath, relPath, stat.size, limits, warnings, {
        languageHints,
        terms,
        names,
        phrases,
        candidates,
        controlPatterns,
        separatorPatterns,
      });
      stats.scannedFiles += 1;
    } else if (kind === 'extracted-text' || kind === 'csv') {
      scanTextFile(filePath, relPath, stat.size, limits, warnings, {
        languageHints,
        terms,
        names,
        phrases,
        candidates,
        controlPatterns,
        separatorPatterns,
      });
      stats.scannedFiles += 1;
    } else {
      stats.skippedFiles += 1;
    }
  }

  return {
    schemaVersion: 1,
    scanner: 'projectProfile',
    rootName: path.basename(absoluteRoot),
    limits,
    fileStats: stats,
    languageHints,
    terms: toSamples(terms, limits.maxTerms),
    names: toSamples(names, limits.maxSamplesPerBucket),
    repeatedPhrases: toSamples(phrases, limits.maxRepeatedPhrases)
      .filter((entry) => entry.count >= limits.minRepeatedPhraseCount),
    characterCandidates: toSamples(candidates, limits.maxCandidates),
    controlCodePatterns: toPatterns(controlPatterns, limits.maxSamplesPerBucket),
    separatorPatterns: toPatterns(separatorPatterns, limits.maxSamplesPerBucket),
    warnings,
  };
}

function collectCandidateFiles(rootDir: string, limits: Required<ProjectProfileScanOptions>, warnings: string[]): string[] {
  const rootStat = statDirectory(rootDir);
  if (!rootStat.isDirectory()) {
    throw new Error(`Project profile root must be a directory: ${rootDir}`);
  }

  const files: string[] = [];
  const queue = [rootDir];
  let entriesVisited = 0;

  while (queue.length > 0 && entriesVisited < limits.maxDirectoryEntries) {
    const current = queue.shift() as string;
    const entries = readDirectory(current)
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));

    for (const entry of entries) {
      entriesVisited += 1;
      if (entriesVisited > limits.maxDirectoryEntries) {
        addWarning(warnings, `Stopped directory walk at maxDirectoryEntries ${limits.maxDirectoryEntries}.`);
        break;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && classifyFile(fullPath) !== 'other') {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

function statDirectory(dirPath: string): fs.Stats {
  try {
    return fs.statSync(dirPath);
  } catch (error) {
    throw new Error(`Cannot stat project profile root ${dirPath}: ${formatCause(error)}`);
  }
}

function readDirectory(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot read project profile directory ${dirPath}: ${formatCause(error)}`);
  }
}

function statFile(filePath: string, relPath: string): fs.Stats {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    throw new Error(`Cannot stat project profile file ${relPath}: ${formatCause(error)}`);
  }
}

function classifyFile(filePath: string): ProjectProfileFileKind {
  const extension = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath).toLowerCase();
  if (extension === '.json' && (
    baseName === 'actors.json'
    || baseName === 'classes.json'
    || baseName === 'enemies.json'
    || baseName === 'items.json'
    || baseName === 'skills.json'
    || baseName === 'states.json'
    || baseName === 'system.json'
    || baseName === 'troops.json'
    || baseName === 'weapons.json'
    || baseName === 'armors.json'
    || /^map\d{3}\.json$/i.test(baseName)
  )) {
    return 'rpg-maker-json';
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return 'extracted-text';
  }
  if (CSV_EXTENSIONS.has(extension)) {
    return 'csv';
  }
  if (WOLF_EXTENSIONS.has(extension)) {
    return 'wolf-data';
  }
  return 'other';
}

function scanJsonFile(
  filePath: string,
  relPath: string,
  size: number,
  limits: Required<ProjectProfileScanOptions>,
  warnings: string[],
  collectors: Collectors,
): void {
  if (size > limits.maxJsonBytes) {
    addWarning(warnings, `Sampled only file stats for ${relPath}: exceeds maxJsonBytes ${limits.maxJsonBytes}.`);
    return;
  }

  const text = readBoundedText(filePath, relPath, limits.maxJsonBytes, warnings);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    addWarning(warnings, `Skipped JSON samples for ${relPath}: ${formatCause(error)}.`);
    return;
  }

  walkJson(parsed, relPath, [], limits, collectors, { visitedNodes: 0 });
}

function scanTextFile(
  filePath: string,
  relPath: string,
  size: number,
  limits: Required<ProjectProfileScanOptions>,
  warnings: string[],
  collectors: Collectors,
): void {
  const text = readBoundedText(filePath, relPath, Math.min(size, limits.maxTextBytes), warnings);
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    collectText(line, relPath, 'text-line', limits, collectors);
  }
  if (size > limits.maxTextBytes) {
    addWarning(warnings, `Sampled first ${limits.maxTextBytes} bytes of ${relPath}; file is ${size} bytes.`);
  }
}

function readBoundedText(filePath: string, relPath: string, maxBytes: number, warnings: string[]): string {
  let handle: number | undefined;
  try {
    handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
    return rmBom(buffer.subarray(0, bytesRead).toString('utf-8'));
  } catch (error) {
    addWarning(warnings, `Cannot read ${relPath}: ${formatCause(error)}.`);
    return '';
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

interface Collectors {
  languageHints: Record<'hangul' | 'hiragana' | 'katakana' | 'kanji' | 'latin', number>;
  terms: Map<string, MutableSample>;
  names: Map<string, MutableSample>;
  phrases: Map<string, MutableSample>;
  candidates: Map<string, MutableSample>;
  controlPatterns: Map<string, MutablePattern>;
  separatorPatterns: Map<string, MutablePattern>;
}

function walkJson(
  value: unknown,
  relPath: string,
  keyPath: string[],
  limits: Required<ProjectProfileScanOptions>,
  collectors: Collectors,
  state: { visitedNodes: number },
): void {
  state.visitedNodes += 1;
  if (state.visitedNodes > limits.maxDirectoryEntries) {
    return;
  }

  if (typeof value === 'string') {
    const key = keyPath[keyPath.length - 1] ?? '';
    const origin = JSON_NAME_KEYS.has(key) ? 'json-name' : JSON_TEXT_KEYS.has(key) ? 'json-text' : 'json-string';
    collectText(value, relPath, origin, limits, collectors);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      walkJson(value[index], relPath, [...keyPath, String(index)], limits, collectors, state);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, 'en'));
    for (const [key, child] of entries) {
      walkJson(child, relPath, [...keyPath, key], limits, collectors, state);
    }
  }
}

function collectText(
  rawText: string,
  relPath: string,
  origin: 'json-name' | 'json-text' | 'json-string' | 'text-line',
  limits: Required<ProjectProfileScanOptions>,
  collectors: Collectors,
): void {
  const normalizedFullText = normalizeWhitespace(rawText);
  const text = truncateSample(normalizedFullText, limits.maxSampleLength);
  if (text.length === 0) {
    return;
  }

  updateLanguageHints(normalizedFullText, collectors.languageHints);
  collectPatterns(normalizedFullText, relPath, limits, collectors.controlPatterns, collectors.separatorPatterns);
  if (looksLikeTranslatablePhrase(text)) {
    addSample(collectors.phrases, text, relPath, limits.maxSampleLength);
    const dialogueBody = extractDialogueBody(normalizedFullText);
    if (dialogueBody !== undefined && looksLikeTranslatablePhrase(dialogueBody)) {
      addSample(collectors.phrases, dialogueBody, relPath, limits.maxSampleLength);
    }
  }
  if (origin === 'json-name') {
    addSample(collectors.names, text, relPath, limits.maxSampleLength);
    addSample(collectors.candidates, text, relPath, limits.maxSampleLength);
  } else {
    collectCharacterCandidateFromLine(text, relPath, limits, collectors.candidates);
  }
  collectTerms(text, relPath, limits, collectors.terms);
}

function collectPatterns(
  text: string,
  relPath: string,
  limits: Required<ProjectProfileScanOptions>,
  controlPatterns: Map<string, MutablePattern>,
  separatorPatterns: Map<string, MutablePattern>,
): void {
  for (const match of text.matchAll(CONTROL_CODE_REGEX)) {
    addPattern(controlPatterns, normalizeControlCode(match[0]), relPath, match[0], limits.maxSampleLength);
  }
  if (SEPARATOR_REGEX.test(text)) {
    addPattern(separatorPatterns, normalizeSeparator(text), relPath, text, limits.maxSampleLength);
  }
}

function collectCharacterCandidateFromLine(
  text: string,
  relPath: string,
  limits: Required<ProjectProfileScanOptions>,
  candidates: Map<string, MutableSample>,
): void {
  const match = /^([^\s:：「『【\[][\p{L}\p{N}_'’・ー -]{1,24})[:：]/u.exec(text);
  if (match) {
    addSample(candidates, match[1].trim(), relPath, limits.maxSampleLength);
  }
}

function extractDialogueBody(text: string): string | undefined {
  const match = /^[^\s:：「『【\[][\p{L}\p{N}_'’・ー -]{1,24}[:：]\s*(.+)$/u.exec(text);
  return match?.[1]?.trim();
}

function collectTerms(
  text: string,
  relPath: string,
  limits: Required<ProjectProfileScanOptions>,
  terms: Map<string, MutableSample>,
): void {
  for (const match of text.matchAll(TOKEN_REGEX)) {
    const token = match[0].trim();
    if (token.length < 2 || token.length > limits.maxSampleLength || /^\d+$/.test(token)) {
      continue;
    }
    addSample(terms, token, relPath, limits.maxSampleLength);
  }
}

function updateLanguageHints(text: string, hints: Record<'hangul' | 'hiragana' | 'katakana' | 'kanji' | 'latin', number>): void {
  for (const char of text) {
    if (/\p{Script=Hangul}/u.test(char)) hints.hangul += 1;
    else if (/\p{Script=Hiragana}/u.test(char)) hints.hiragana += 1;
    else if (/\p{Script=Katakana}/u.test(char)) hints.katakana += 1;
    else if (/\p{Script=Han}/u.test(char)) hints.kanji += 1;
    else if (/[A-Za-z]/.test(char)) hints.latin += 1;
  }
}

function looksLikeTranslatablePhrase(text: string): boolean {
  return text.length >= 4 && /[\p{L}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

function normalizeSampleText(text: string, maxLength: number): string {
  return truncateSample(normalizeWhitespace(text), maxLength);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateSample(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeControlCode(code: string): string {
  return code.replace(/\[[^\]]*\]/g, '[]');
}

function normalizeSeparator(separator: string): string {
  return separator.replace(/\s+/g, ' ').replace(/[^- ]+/g, '<label>').trim();
}

function addSample(samples: Map<string, MutableSample>, value: string, file: string, maxLength: number): void {
  const text = normalizeSampleText(value, maxLength);
  const existing = samples.get(text);
  if (existing) {
    existing.count += 1;
    existing.files.add(file);
  } else {
    samples.set(text, { text, count: 1, files: new Set([file]) });
  }
}

function addPattern(patterns: Map<string, MutablePattern>, pattern: string, file: string, example: string, maxLength: number): void {
  const normalizedExample = normalizeSampleText(example, maxLength);
  const existing = patterns.get(pattern);
  if (existing) {
    existing.count += 1;
    existing.files.add(file);
    if (existing.examples.length < 5 && !existing.examples.includes(normalizedExample)) {
      existing.examples.push(normalizedExample);
    }
  } else {
    patterns.set(pattern, { pattern, count: 1, files: new Set([file]), examples: [normalizedExample] });
  }
}

function toSamples(samples: Map<string, MutableSample>, limit: number): ProjectProfileSample[] {
  return [...samples.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'en'))
    .slice(0, limit)
    .map((sample) => ({
      text: sample.text,
      count: sample.count,
      files: [...sample.files].sort((a, b) => a.localeCompare(b, 'en')).slice(0, 5),
    }));
}

function toPatterns(patterns: Map<string, MutablePattern>, limit: number): ProjectProfilePattern[] {
  return [...patterns.values()]
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern, 'en'))
    .slice(0, limit)
    .map((pattern) => ({
      pattern: pattern.pattern,
      count: pattern.count,
      files: [...pattern.files].sort((a, b) => a.localeCompare(b, 'en')).slice(0, 5),
      examples: pattern.examples.slice(0, 5),
    }));
}

function addLargestFile(stats: ProjectProfileFileStats, file: { path: string; bytes: number; kind: ProjectProfileFileKind }): void {
  stats.largestFiles.push(file);
  stats.largestFiles.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path, 'en'));
  if (stats.largestFiles.length > MAX_LARGEST_FILES) {
    stats.largestFiles.length = MAX_LARGEST_FILES;
  }
}

function addWarning(warnings: string[], warning: string): void {
  if (warnings.length < MAX_WARNINGS) {
    warnings.push(warning);
  }
}

function normalizeRelativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function formatCause(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
