import * as path from 'path';

export class AbortError extends Error {
  public readonly reason: unknown;

  constructor(reason?: unknown) {
    super(reason instanceof Error ? reason.message : '작업이 취소되었습니다.');
    this.name = 'AbortError';
    this.reason = reason;
  }
}

export interface PromisePoolOptions {
  concurrency: number;
  signal?: AbortSignal;
}

export type PromisePoolWorker<T, R> = (item: T, index: number, signal?: AbortSignal) => Promise<R> | R;

export function runWithConcurrency<T, R>(
  items: readonly T[],
  worker: PromisePoolWorker<T, R>,
  options: PromisePoolOptions,
): Promise<R[]> {
  const concurrency = normalizeConcurrency(options.concurrency);
  const signal = options.signal;
  throwIfAborted(signal);

  if (items.length === 0) {
    return Promise.resolve([]);
  }

  return new Promise<R[]>((resolve, reject) => {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    let active = 0;
    let completed = 0;
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      fail(new AbortError(getAbortReason(signal)));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const launchNext = () => {
      if (settled) {
        return;
      }

      try {
        throwIfAborted(signal);
      } catch (err) {
        fail(err);
        return;
      }

      while (active < concurrency && nextIndex < items.length && !settled) {
        const index = nextIndex++;
        active++;

        Promise.resolve()
          .then(() => {
            throwIfAborted(signal);
            return worker(items[index], index, signal);
          })
          .then((result) => {
            results[index] = result;
            active--;
            completed++;

            if (completed === items.length) {
              settled = true;
              cleanup();
              resolve(results);
              return;
            }

            launchNext();
          })
          .catch((err) => {
            active--;
            fail(err);
          });
      }
    };

    launchNext();
  });
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

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be an integer greater than or equal to 1');
  }
  return concurrency;
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
