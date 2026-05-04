import fs from 'fs';
import path from 'path';

export type LlmProjectGame = 'mvmz' | 'wolf';

export interface LlmProjectArg {
  dir: string;
  game: LlmProjectGame;
}

export interface ValidatedLlmProjectPath {
  dir: string;
  game: LlmProjectGame;
  extractDir: string;
}

export interface ValidateLlmProjectPathOptions {
  allowedRoots?: string[];
}

export function coerceLlmProjectArg(value: unknown): LlmProjectArg {
  if (!value || typeof value !== 'object') {
    throw new Error('LLM 프로젝트 경로 정보가 올바르지 않습니다.');
  }
  const candidate = value as { dir?: unknown; game?: unknown };
  if (typeof candidate.dir !== 'string' || !candidate.dir.trim()) {
    throw new Error('LLM 프로젝트 경로가 비어 있습니다.');
  }
  if (candidate.game !== 'mvmz' && candidate.game !== 'wolf') {
    throw new Error('지원하지 않는 게임 형식입니다.');
  }
  return { dir: candidate.dir, game: candidate.game };
}

export function validateLlmProjectPath(
  input: LlmProjectArg,
  options: ValidateLlmProjectPathOptions = {},
): ValidatedLlmProjectPath {
  const decoded = decodePathInput(input.dir);
  if (decoded.includes('\0')) {
    throw new Error('프로젝트 경로에 허용되지 않는 문자가 포함되어 있습니다.');
  }
  if (isUncPath(decoded)) {
    throw new Error('네트워크(UNC) 경로는 LLM 프로젝트 경로로 사용할 수 없습니다.');
  }
  if (hasWindowsAlternateDataStream(decoded)) {
    throw new Error('Windows 대체 데이터 스트림 경로는 사용할 수 없습니다.');
  }
  if (!isAbsolutePath(decoded)) {
    throw new Error('프로젝트 경로는 절대 경로여야 합니다.');
  }

  const resolved = path.resolve(decoded);
  if (!fs.existsSync(resolved)) {
    throw new Error('프로젝트 경로가 존재하지 않습니다.');
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error('프로젝트 경로는 폴더여야 합니다.');
  }

  const canonical = fs.realpathSync.native(resolved);
  const allowedRoots = normalizeAllowedRoots(options.allowedRoots);
  if (allowedRoots.length === 0) {
    throw new Error('먼저 프로젝트 폴더를 선택해야 합니다.');
  }
  if (!allowedRoots.some((root) => isPathInsideRoot(normalizeComparable(canonical), root))) {
    throw new Error('선택한 프로젝트 폴더 밖의 경로는 사용할 수 없습니다.');
  }

  if (input.game === 'mvmz') {
    validateRpgMakerDataDir(canonical);
    return { dir: canonical, game: input.game, extractDir: path.join(canonical, 'Extract') };
  }

  validateWolfProjectDir(canonical);
  return { dir: canonical, game: input.game, extractDir: path.join(canonical, '_Extract', 'Texts') };
}

export function rememberAllowedProjectRoot(allowedRoots: string[], dir: string): string[] {
  let canonical: string;
  try {
    canonical = fs.existsSync(dir) ? fs.realpathSync.native(dir) : path.resolve(dir);
  } catch {
    canonical = path.resolve(dir);
  }
  const comparable = normalizeComparable(canonical);
  if (allowedRoots.some((root) => normalizeComparable(root) === comparable)) {
    return allowedRoots;
  }
  return [...allowedRoots, canonical];
}

function validateRpgMakerDataDir(dir: string): void {
  const name = path.basename(dir).toLowerCase();
  const hasKnownJson = ['System.json', 'MapInfos.json', 'Actors.json', 'Items.json']
    .some((fileName) => fs.existsSync(path.join(dir, fileName)));
  const hasExtractDir = fs.existsSync(path.join(dir, 'Extract'));
  if (name !== 'data' || (!hasKnownJson && !hasExtractDir)) {
    throw new Error('RPG Maker MV/MZ의 data 폴더만 LLM 번역 경로로 사용할 수 있습니다.');
  }
}

function validateWolfProjectDir(dir: string): void {
  const hasDirectDataWolf = fs.existsSync(path.join(dir, 'Data.wolf'));
  const hasNestedDataWolf = fs.existsSync(path.join(dir, 'Data', 'Data.wolf'))
    || fs.existsSync(path.join(dir, 'data', 'Data.wolf'));
  const hasExtractedTexts = fs.existsSync(path.join(dir, '_Extract', 'Texts'));
  if (!hasDirectDataWolf && !hasNestedDataWolf && !hasExtractedTexts) {
    throw new Error('Wolf RPG Editor 프로젝트 폴더만 LLM 번역 경로로 사용할 수 있습니다.');
  }
}

function decodePathInput(value: string): string {
  const trimmed = value.trim();
  if (!looksLikeStrictBase64(trimmed)) {
    return trimmed;
  }
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  if (decoded.includes('\uFFFD') || decoded.includes('\0')) {
    return trimmed;
  }
  if (Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') !== trimmed.replace(/=+$/, '')) {
    return trimmed;
  }
  if (!/[\\/]/.test(decoded) && !/^[a-zA-Z]:/.test(decoded)) {
    return trimmed;
  }
  return decoded.trim();
}

function looksLikeStrictBase64(value: string): boolean {
  return value.length >= 8
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeAllowedRoots(allowedRoots: string[] | undefined): string[] {
  return (allowedRoots ?? [])
    .filter((root) => typeof root === 'string' && root.trim())
    .map((root) => {
      const resolved = path.resolve(root);
      const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
      return normalizeComparable(canonical);
    });
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function normalizeComparable(candidatePath: string): string {
  return path.resolve(candidatePath).toLowerCase();
}

function isAbsolutePath(candidatePath: string): boolean {
  return path.isAbsolute(candidatePath) || /^[a-zA-Z]:[\\/]/.test(candidatePath);
}

function hasWindowsAlternateDataStream(candidatePath: string): boolean {
  const parsed = path.parse(candidatePath);
  const withoutRoot = candidatePath.slice(parsed.root.length);
  return withoutRoot.split(/[\\/]/).some((segment) => segment.includes(':'));
}

function isUncPath(candidatePath: string): boolean {
  return /^[/\\]{2}[^/\\]/.test(candidatePath);
}
