export const MAX_TRANSLATION_CONCURRENCY = 8;
export const MAX_TRANSLATION_RPM = 60_000;

export function normalizeTranslationConcurrency(value: unknown): number {
  return Number.isInteger(value) ? Math.max(1, Math.min(MAX_TRANSLATION_CONCURRENCY, value as number)) : 1;
}

export function normalizeTranslationRpm(value: unknown): number {
  return Number.isInteger(value) ? Math.max(0, Math.min(MAX_TRANSLATION_RPM, value as number)) : 0;
}

export class TranslationAbortedError extends Error {
  constructor() {
    super('Translation aborted');
  }
}

interface PendingRequest {
  start: () => void;
  reject: (error: Error) => void;
}

/** One scheduler per translation run, shared by every file and chunk. */
export class TranslationRequestScheduler {
  readonly concurrency: number;
  private readonly intervalMs: number;
  private readonly pending: PendingRequest[] = [];
  private active = 0;
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private cancelled = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(options: { concurrency?: unknown; requestsPerMinute?: unknown; isAborted?: () => boolean } = {}) {
    this.concurrency = normalizeTranslationConcurrency(options.concurrency);
    const rpm = normalizeTranslationRpm(options.requestsPerMinute);
    this.intervalMs = rpm > 0 ? 60_000 / rpm : 0;
    this.isExternallyAborted = options.isAborted;
  }

  private readonly isExternallyAborted?: () => boolean;

  isAborted(): boolean {
    return this.cancelled || !!this.isExternallyAborted?.();
  }

  cancel(): void {
    this.cancelled = true;
    this.pump();
  }

  /** Called inside a failed request, before its permit is released. */
  pauseFor(delayMs: number): void {
    if (Number.isFinite(delayMs) && delayMs > 0) {
      this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
    }
  }

  run<T>(request: () => Promise<T>): Promise<T> {
    if (this.isAborted()) return Promise.reject(new TranslationAbortedError());
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        reject,
        start: () => {
          // Keep active requests alive until they settle, even after cancellation.
          void Promise.resolve().then(() => {
            if (this.isAborted()) throw new TranslationAbortedError();
            return request();
          }).then(resolve, reject).finally(() => {
            this.active--;
            this.pump();
          });
        },
      });
      this.pump();
    });
  }

  async wait(delayMs: number): Promise<void> {
    const until = Date.now() + delayMs;
    while (Date.now() < until) {
      if (this.isAborted()) throw new TranslationAbortedError();
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, until - Date.now())));
    }
    if (this.isAborted()) throw new TranslationAbortedError();
  }

  private pump(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.isAborted()) {
      for (const request of this.pending.splice(0)) request.reject(new TranslationAbortedError());
      return;
    }
    while (this.pending.length > 0 && this.active < this.concurrency) {
      const now = Date.now();
      if (Math.max(this.nextStartAt, this.cooldownUntil) > now) break;
      const request = this.pending.shift()!;
      this.active++;
      this.nextStartAt = now + this.intervalMs;
      request.start();
    }
    if (this.pending.length > 0) {
      const delay = this.active >= this.concurrency
        ? 100
        : Math.max(1, Math.min(100, Math.max(this.nextStartAt, this.cooldownUntil) - Date.now()));
      this.timer = setTimeout(() => this.pump(), delay);
    }
  }
}
