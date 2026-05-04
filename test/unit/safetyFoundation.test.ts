import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  AtomicFileWriteError,
  atomicWriteJsonFile,
  atomicWriteTextFile,
  cleanupStaleAtomicTempFiles,
} from '../../src/ts/libs/atomicFile';
import {
  AbortError,
  DirectoryOperationLock,
  runWithConcurrency,
} from '../../src/ts/libs/concurrency';

const sandboxRoot = path.resolve('artifacts', 'unit', 'safetyFoundation');
let sequence = 0;
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('atomic file writes', () => {
  it('writes text and JSON through same-directory temp replacement', () => {
    const dir = makeSandboxDir();
    const textPath = path.join(dir, 'out.txt');
    const jsonPath = path.join(dir, 'state.json');

    atomicWriteTextFile(textPath, 'hello');
    atomicWriteJsonFile(jsonPath, { ok: true }, 2);

    expect(fs.readFileSync(textPath, 'utf-8')).toBe('hello');
    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))).toEqual({ ok: true });
    expect(listAtomicTemps(dir)).toEqual([]);
  });

  it('removes stale temp files only for the target file pattern', () => {
    const dir = makeSandboxDir();
    const targetPath = path.join(dir, 'state.json');
    const stalePath = path.join(dir, '.state.json.atomic-stale.tmp');
    const unrelatedPath = path.join(dir, '.other.json.atomic-stale.tmp');
    fs.writeFileSync(stalePath, 'stale', 'utf-8');
    fs.writeFileSync(unrelatedPath, 'keep', 'utf-8');

    const oldSeconds = Math.floor((Date.now() - 60_000) / 1000);
    fs.utimesSync(stalePath, oldSeconds, oldSeconds);
    const result = cleanupStaleAtomicTempFiles(targetPath, { maxAgeMs: 1, nowMs: Date.now() });

    expect(result.removed).toEqual([stalePath]);
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(unrelatedPath)).toBe(true);
  });

  it('throws a typed error when the target directory is missing', () => {
    const missingPath = path.join(makeSandboxDir(), 'missing', 'out.txt');

    expect(() => atomicWriteTextFile(missingPath, 'data')).toThrow(AtomicFileWriteError);
  });
});

describe('promise pool concurrency', () => {
  it('limits active workers and preserves result order', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await runWithConcurrency([1, 2, 3, 4, 5], async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
      return item * 10;
    }, { concurrency: 2 });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('stops launching queued work when aborted', async () => {
    const controller = new AbortController();
    const started: number[] = [];

    await expect(runWithConcurrency([1, 2, 3], (item) => {
      started.push(item);
      controller.abort('stop');
      return item;
    }, { concurrency: 1, signal: controller.signal })).rejects.toThrow(AbortError);

    expect(started).toEqual([1]);
  });
});

describe('directory operation lock', () => {
  it('serializes operations for the same directory', async () => {
    const lock = new DirectoryOperationLock();
    const dir = makeSandboxDir();
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    await Promise.all([1, 2, 3].map((item) => lock.runExclusive(dir, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`start-${item}`);
      await delay(5);
      order.push(`end-${item}`);
      active--;
      return item;
    })));

    expect(maxActive).toBe(1);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  it('keeps the directory locked when a queued waiter is aborted', async () => {
    const lock = new DirectoryOperationLock();
    const dir = makeSandboxDir();
    const controller = new AbortController();
    let firstRelease!: () => void;
    let active = 0;
    let maxActive = 0;

    const first = lock.runExclusive(dir, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        firstRelease = resolve;
      });
      active--;
    });
    await delay(0);

    const aborted = lock.runExclusive(dir, () => {
      throw new Error('aborted waiter should not acquire the lock');
    }, { signal: controller.signal });
    controller.abort('cancel queued waiter');

    const third = lock.runExclusive(dir, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      active--;
    });

    firstRelease();

    await Promise.all([
      first,
      expect(aborted).rejects.toThrow(AbortError),
      third,
    ]);
    expect(maxActive).toBe(1);
  });
});

function makeSandboxDir(): string {
  const dir = path.join(sandboxRoot, `${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

function listAtomicTemps(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.includes('.atomic-'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
