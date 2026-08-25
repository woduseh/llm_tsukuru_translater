import fs from 'fs';
import path from 'path';

export type WolfArchiveDecryptor = (file: string) => Promise<void>;

export interface WolfInitialDecryptTarget {
  projectRoot: string;
  dataDir: string;
}

export const WOLF_ARCHIVE_BACKUP_SUFFIX = '.tsukuru-backup';

export function wolfArchiveBackupPath(archivePath: string): string {
  return `${archivePath}${WOLF_ARCHIVE_BACKUP_SUFFIX}`;
}

export async function decryptWolfArchives(
  files: readonly string[],
  decryptFile: WolfArchiveDecryptor,
): Promise<void> {
  for (const file of files) {
    await decryptFile(file);
  }
}

export async function decryptInitialWolfArchives(
  files: readonly string[],
  target: WolfInitialDecryptTarget,
  decryptFile: WolfArchiveDecryptor,
): Promise<void> {
  const projectRoot = path.resolve(target.projectRoot);
  const dataDir = path.resolve(target.dataDir);
  const dataRelative = path.relative(projectRoot, dataDir);
  if (dataRelative.toLowerCase() !== 'data' || path.dirname(dataDir) !== projectRoot) {
    throw new Error(`Wolf 초기 복호화 Data 경로가 프로젝트 바로 아래가 아닙니다: ${dataDir}`);
  }
  if (fs.existsSync(dataDir)) {
    throw new Error('기존 Wolf Data 폴더가 있어 archive 초기 복호화를 중단했습니다.');
  }

  const archiveMoves = prepareArchiveMoves(files, projectRoot);

  try {
    await decryptWolfArchives(files, decryptFile);
  } catch (error) {
    try {
      removeDataCreatedByFailedDecrypt(dataDir);
    } catch (rollbackError) {
      throw new Error(
        `Wolf archive 복호화와 새 Data 폴더 rollback에 모두 실패했습니다: ${(error as Error).message}; rollback: ${(rollbackError as Error).message}`,
      );
    }
    throw error;
  }

  const dataStat = fs.existsSync(dataDir) ? fs.lstatSync(dataDir) : null;
  if (!dataStat?.isDirectory() || dataStat.isSymbolicLink()) {
    removeDataCreatedByFailedDecrypt(dataDir);
    throw new Error('Wolf archive 복호화가 완료되었지만 정상적인 Data 폴더가 생성되지 않았습니다.');
  }

  const moved: ArchiveMove[] = [];
  try {
    for (const move of archiveMoves) {
      fs.renameSync(move.archivePath, move.backupPath);
      moved.push(move);
    }
  } catch (error) {
    const rollbackErrors = restoreMovedArchives(moved);
    try {
      removeDataCreatedByFailedDecrypt(dataDir);
    } catch (rollbackError) {
      rollbackErrors.push(`Data: ${(rollbackError as Error).message || String(rollbackError)}`);
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Wolf archive 비활성화와 rollback에 모두 실패했습니다: ${(error as Error).message}; rollback: ${rollbackErrors.join(', ')}`,
      );
    }
    throw error;
  }
}

interface ArchiveMove {
  archivePath: string;
  backupPath: string;
}

function prepareArchiveMoves(files: readonly string[], projectRoot: string): ArchiveMove[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const archivePath = path.resolve(file);
    const relative = path.relative(projectRoot, archivePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Wolf archive가 프로젝트 밖에 있습니다: ${archivePath}`);
    }
    if (path.extname(archivePath).toLowerCase() !== '.wolf') {
      throw new Error(`Wolf archive 확장자가 올바르지 않습니다: ${archivePath}`);
    }
    const stat = fs.lstatSync(archivePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Wolf archive가 일반 파일이 아닙니다: ${archivePath}`);
    }
    const key = process.platform === 'win32' ? archivePath.toLowerCase() : archivePath;
    if (seen.has(key)) throw new Error(`중복된 Wolf archive입니다: ${archivePath}`);
    seen.add(key);
    const backupPath = wolfArchiveBackupPath(archivePath);
    if (fs.existsSync(backupPath)) {
      throw new Error(`Wolf archive 백업 경로가 이미 존재합니다: ${backupPath}`);
    }
    return { archivePath, backupPath };
  });
}

function restoreMovedArchives(moved: readonly ArchiveMove[]): string[] {
  const errors: string[] = [];
  for (const move of [...moved].reverse()) {
    try {
      if (fs.existsSync(move.backupPath)) fs.renameSync(move.backupPath, move.archivePath);
    } catch (error) {
      errors.push(`${move.archivePath}: ${(error as Error).message || String(error)}`);
    }
  }
  return errors;
}

function removeDataCreatedByFailedDecrypt(dataDir: string): void {
  if (!fs.existsSync(dataDir)) return;
  const stat = fs.lstatSync(dataDir);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(dataDir);
    return;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
