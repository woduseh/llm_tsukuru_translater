import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type AtomicWritePhase = 'cleanup' | 'write' | 'replace';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
  cleanupStaleTempFiles?: boolean;
  staleTempMaxAgeMs?: number;
  nowMs?: number;
}

export interface AtomicCleanupResult {
  removed: string[];
}

export class AtomicFileWriteError extends Error {
  public readonly finalPath: string;
  public readonly tempPath?: string;
  public readonly phase: AtomicWritePhase;
  public readonly cause: unknown;
  public readonly cleanupCause?: unknown;

  constructor(
    message: string,
    finalPath: string,
    phase: AtomicWritePhase,
    cause: unknown,
    tempPath?: string,
    cleanupCause?: unknown,
  ) {
    super(message);
    this.name = 'AtomicFileWriteError';
    this.finalPath = finalPath;
    this.tempPath = tempPath;
    this.phase = phase;
    this.cause = cause;
    this.cleanupCause = cleanupCause;
  }
}

export function atomicWriteTextFile(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): void {
  const finalPath = path.resolve(filePath);
  const dir = path.dirname(finalPath);
  const tempPath = path.join(dir, createAtomicTempFileName(finalPath));
  const encoding = options.encoding ?? 'utf-8';
  let fd: number | undefined;

  if (options.cleanupStaleTempFiles !== false) {
    cleanupStaleAtomicTempFiles(finalPath, {
      maxAgeMs: options.staleTempMaxAgeMs,
      nowMs: options.nowMs,
    });
  }

  try {
    fd = fs.openSync(tempPath, 'wx', 0o666);
    fs.writeFileSync(fd, content, { encoding });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, finalPath);
  } catch (err) {
    const phase: AtomicWritePhase = fd === undefined && fs.existsSync(tempPath) ? 'replace' : 'write';
    let cleanupCause: unknown;

    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (closeErr) {
        cleanupCause = closeErr;
      }
    }

    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (unlinkErr) {
        cleanupCause = cleanupCause ?? unlinkErr;
      }
    }

    throw new AtomicFileWriteError(`원자적 파일 쓰기 실패: ${finalPath}`, finalPath, phase, err, tempPath, cleanupCause);
  }
}

export function atomicWriteJsonFile(
  filePath: string,
  data: unknown,
  indent: number | string = 2,
  options: AtomicWriteOptions = {},
): void {
  const json = JSON.stringify(data, null, indent);
  if (json === undefined) {
    throw new AtomicFileWriteError(
      `JSON으로 직렬화할 수 없습니다: ${path.resolve(filePath)}`,
      path.resolve(filePath),
      'write',
      new TypeError('JSON.stringify returned undefined'),
    );
  }
  atomicWriteTextFile(filePath, json, { ...options, encoding: options.encoding ?? 'utf-8' });
}

export function cleanupStaleAtomicTempFiles(
  filePath: string,
  options: { maxAgeMs?: number; nowMs?: number } = {},
): AtomicCleanupResult {
  const finalPath = path.resolve(filePath);
  const dir = path.dirname(finalPath);
  const prefix = atomicTempPrefix(finalPath);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_STALE_TEMP_MAX_AGE_MS;
  const nowMs = options.nowMs ?? Date.now();
  const removed: string[] = [];

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) {
        continue;
      }

      const candidatePath = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(candidatePath);
      } catch (err) {
        if (isNodeErrorCode(err, 'ENOENT')) {
          continue;
        }
        throw err;
      }

      if (nowMs - stat.mtimeMs < maxAgeMs) {
        continue;
      }

      fs.unlinkSync(candidatePath);
      removed.push(candidatePath);
    }
  } catch (err) {
    throw new AtomicFileWriteError(`원자적 파일 임시 파일 정리 실패: ${finalPath}`, finalPath, 'cleanup', err);
  }

  return { removed };
}

function createAtomicTempFileName(finalPath: string): string {
  const random = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  return `${atomicTempPrefix(finalPath)}${random}.tmp`;
}

function atomicTempPrefix(finalPath: string): string {
  return `.${path.basename(finalPath)}.atomic-`;
}

function isNodeErrorCode(err: unknown, code: string): boolean {
  return typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === code;
}
