import fs from 'fs';
import path from 'path';

export interface WolfProjectPaths {
  projectRoot: string;
  dataDir: string;
  extractRoot: string;
}

export interface ResolveWolfProjectOptions {
  allowEncryptedProject?: boolean;
}

export interface ResolvedWolfSource {
  diskPath: string;
  sourceFile: string;
}

export function resolveWolfProjectPaths(
  selectedPath: string,
  options: ResolveWolfProjectOptions = {},
): WolfProjectPaths {
  if (!selectedPath || !fs.existsSync(selectedPath)) {
    throw new Error('지정된 Wolf 프로젝트 폴더가 없습니다.');
  }

  const selectedRoot = fs.realpathSync(path.resolve(selectedPath));
  if (!fs.statSync(selectedRoot).isDirectory()) {
    throw new Error('지정된 Wolf 프로젝트 경로가 폴더가 아닙니다.');
  }

  let projectRoot: string;
  let dataDir: string | undefined;
  if (path.basename(selectedRoot).toLowerCase() === 'data') {
    projectRoot = path.dirname(selectedRoot);
    dataDir = selectedRoot;
  } else {
    projectRoot = selectedRoot;
    dataDir = findChildDirectory(projectRoot, 'data');
  }

  if (!dataDir) {
    const encryptedArchive = findChildFile(projectRoot, 'data.wolf');
    if (!options.allowEncryptedProject || !encryptedArchive) {
      throw new Error('Wolf 프로젝트의 Data 폴더 또는 Data.wolf를 찾을 수 없습니다.');
    }
    dataDir = path.join(projectRoot, 'Data');
  }

  return {
    projectRoot,
    dataDir,
    extractRoot: path.join(projectRoot, '_Extract'),
  };
}

export function findFilesWithinRoot(root: string, extension: string): string[] {
  const resolvedRoot = fs.realpathSync(path.resolve(root));
  const normalizedExtension = extension.toLowerCase();
  const files: string[] = [];

  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === normalizedExtension) {
        files.push(candidate);
      }
    }
  };

  visit(resolvedRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

export function findWolfArchivesForInitialDecrypt(paths: WolfProjectPaths): string[] {
  // Successful initial decryption moves archives to a non-.wolf recovery
  // name so the runtime uses loose Data. Once Data exists, never decrypt again.
  if (fs.existsSync(paths.dataDir)) return [];
  return findFilesWithinRoot(paths.projectRoot, '.wolf');
}

export function toWolfProjectRelativePath(projectRoot: string, sourcePath: string): string {
  const root = path.resolve(projectRoot);
  const source = path.resolve(sourcePath);
  if (!isPathWithin(root, source)) {
    throw new Error(`Wolf 소스 파일이 선택 프로젝트 밖에 있습니다: ${sourcePath}`);
  }
  const relative = path.relative(root, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Wolf 소스 파일을 프로젝트 상대 경로로 만들 수 없습니다: ${sourcePath}`);
  }
  return relative.split(path.sep).join('/');
}

export function resolveWolfSourceFile(paths: WolfProjectPaths, sourceFile: string): ResolvedWolfSource {
  if (!sourceFile || sourceFile.includes('\0')) {
    throw new Error('Wolf metadata sourceFile이 비어 있거나 올바르지 않습니다.');
  }

  const projectRoot = fs.realpathSync(paths.projectRoot);
  const dataRoot = fs.realpathSync(paths.dataDir);
  let candidate: string;

  if (path.isAbsolute(sourceFile)) {
    candidate = path.resolve(sourceFile);
  } else {
    const normalizedSource = sourceFile.replace(/[\\/]+/g, path.sep);
    const projectCandidate = path.resolve(projectRoot, normalizedSource);
    candidate = isPathWithin(dataRoot, projectCandidate)
      ? projectCandidate
      : path.resolve(dataRoot, normalizedSource);
  }

  if (!isPathWithin(dataRoot, candidate)) {
    throw new Error(`Wolf metadata sourceFile이 선택 Data 폴더 밖을 가리킵니다: ${sourceFile}`);
  }
  if (!fs.existsSync(candidate)) {
    throw new Error(`Wolf 원본 데이터 파일이 없습니다: ${candidate}`);
  }
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Wolf 원본 데이터 경로가 일반 파일이 아닙니다: ${candidate}`);
  }

  const realCandidate = fs.realpathSync(candidate);
  if (!isPathWithin(dataRoot, realCandidate)) {
    throw new Error(`Wolf 원본 데이터 파일이 선택 Data 폴더 밖에 있습니다: ${sourceFile}`);
  }

  return {
    diskPath: realCandidate,
    sourceFile: toWolfProjectRelativePath(projectRoot, realCandidate),
  };
}

export function resolveWolfExtractRootForApply(paths: WolfProjectPaths): string {
  const canonicalMetadata = path.join(paths.extractRoot, '.extracteddata');
  if (fs.existsSync(canonicalMetadata) && fs.statSync(canonicalMetadata).isFile()) {
    return paths.extractRoot;
  }

  // Older builds placed _Extract under a directly selected Data directory.
  const legacyRoot = path.join(paths.dataDir, '_Extract');
  const legacyMetadata = path.join(legacyRoot, '.extracteddata');
  if (
    path.resolve(legacyRoot) !== path.resolve(paths.extractRoot)
    && isPathWithin(paths.dataDir, legacyRoot)
    && fs.existsSync(legacyMetadata)
    && fs.statSync(legacyMetadata).isFile()
  ) {
    return legacyRoot;
  }
  return paths.extractRoot;
}

export function isPathWithin(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findChildDirectory(root: string, name: string): string | undefined {
  const target = name.toLowerCase();
  const entry = fs.readdirSync(root, { withFileTypes: true })
    .find((candidate) => !candidate.isSymbolicLink() && candidate.isDirectory() && candidate.name.toLowerCase() === target);
  return entry ? path.join(root, entry.name) : undefined;
}

function findChildFile(root: string, name: string): string | undefined {
  const target = name.toLowerCase();
  const entry = fs.readdirSync(root, { withFileTypes: true })
    .find((candidate) => !candidate.isSymbolicLink() && candidate.isFile() && candidate.name.toLowerCase() === target);
  return entry ? path.join(root, entry.name) : undefined;
}
