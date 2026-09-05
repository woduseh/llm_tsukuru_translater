import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationAbortedError, TranslationRequestScheduler, normalizeTranslationConcurrency } from '../../src/ts/libs/translationRequestScheduler';

afterEach(() => vi.useRealTimers());

describe('translation request scheduler', () => {
  it('caps requests and starts queued work in submission order', async () => {
    vi.useFakeTimers();
    const scheduler = new TranslationRequestScheduler({ concurrency: 2 });
    let active = 0;
    let maximum = 0;
    const started: number[] = [];
    const jobs = Array.from({ length: 7 }, (_, i) => scheduler.run(async () => {
      started.push(i);
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, i === 0 ? 100 : 10));
      active--;
      return i;
    }));
    await vi.runAllTimersAsync();
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(maximum).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('paces request starts across concurrent workers and does not burst after idle time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new TranslationRequestScheduler({ concurrency: 4, requestsPerMinute: 30 });
    const starts: number[] = [];
    const request = () => scheduler.run(async () => { starts.push(Date.now()); });
    const jobs = [request(), request(), request()];
    await vi.runAllTimersAsync();
    await Promise.all(jobs);
    expect(starts).toEqual([0, 2000, 4000]);
    await vi.advanceTimersByTimeAsync(10_000);
    const later = [request(), request()];
    await vi.runAllTimersAsync();
    await Promise.all(later);
    expect(starts.slice(-2)).toEqual([14000, 16000]);
  });

  it('shares and extends cooldown before allowing another request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new TranslationRequestScheduler({ concurrency: 1 });
    const first = scheduler.run(async () => { scheduler.pauseFor(5000); });
    const start = vi.fn(async () => Date.now());
    const next = scheduler.run(start);
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.pauseFor(6000);
    scheduler.pauseFor(1);
    await vi.advanceTimersByTimeAsync(5999);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(await next).toBe(8000);
  });

  it('cancels queued requests promptly while draining the active request', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const scheduler = new TranslationRequestScheduler({ concurrency: 1, isAborted: () => aborted });
    let release!: () => void;
    const running = scheduler.run(() => new Promise<void>((resolve) => { release = resolve; }));
    const pendingFn = vi.fn(async () => undefined);
    const pending = scheduler.run(pendingFn);
    const rejected = expect(pending).rejects.toBeInstanceOf(TranslationAbortedError);
    await vi.advanceTimersByTimeAsync(1);
    aborted = true;
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(pendingFn).not.toHaveBeenCalled();
    release();
    await running;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a long retry wait without waiting for the provider delay', async () => {
    vi.useFakeTimers();
    const scheduler = new TranslationRequestScheduler();
    const waiting = scheduler.wait(120_000);
    const rejected = expect(waiting).rejects.toBeInstanceOf(TranslationAbortedError);
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds invalid or excessive concurrency without provider-specific hard caps', () => {
    expect([undefined, NaN, 1.5, -1, 4, 8, 100].map(normalizeTranslationConcurrency)).toEqual([1, 1, 1, 1, 4, 8, 8]);
  });
});
