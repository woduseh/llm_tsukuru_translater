import * as path from 'path';

export class AbortError extends Error {
  public readonly reason: unknown;

  constructor(reason?: unknown) {
    super(reason instanceof Error ? reason.message : '작업이 취소되었습니다.');
    this.name = 'AbortError';
    this.reason = reason;
  }
}

export interface DirectoryLockOptions {
  signal?: AbortSignal;
}

export class DirectoryOperationLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(
    directory: string,
    operation: () => Promise<T> | T,
    options: DirectoryLockOptions = {},
  ): Promise<T> {
    const key = normalizeDirectoryLockKey(directory);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);
    tail.then(
      () => this.deleteTailIfCurrent(key, tail),
      () => this.deleteTailIfCurrent(key, tail),
    );

    try {
      await waitForLock(previous, options.signal);
      throwIfAborted(options.signal);
      return await operation();
    } finally {
      releaseCurrent();
    }
  }

  private deleteTailIfCurrent(key: string, tail: Promise<void>): void {
    if (this.tails.get(key) === tail) {
      this.tails.delete(key);
    }
  }
}

export const directoryOperationLock = new DirectoryOperationLock();

export function runWithDirectoryLock<T>(
  directory: string,
  operation: () => Promise<T> | T,
  options: DirectoryLockOptions = {},
): Promise<T> {
  return directoryOperationLock.runExclusive(directory, operation, options);
}

export function normalizeDirectoryLockKey(directory: string): string {
  const resolved = path.resolve(directory);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AbortError(getAbortReason(signal));
  }
}

function waitForLock(lock: Promise<void>, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  if (!signal) {
    return lock;
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new AbortError(getAbortReason(signal)));
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    lock.then(
      () => {
        cleanup();
        resolve();
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
}

function getAbortReason(signal?: AbortSignal): unknown {
  return signal && 'reason' in signal ? signal.reason : undefined;
}
