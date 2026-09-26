import { expect, it, vi } from 'vitest';
import { createReviewScan, readReviewEntries } from '../../src/renderer/reviewFileLoader';

it('stops obsolete scans before reading more files and never returns their partial results', async () => {
  const scan = createReviewScan();
  const old = scan.begin();
  let release!: (value: string) => void;
  const read = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
  const pending = readReviewEntries(['old-a', 'old-b'], read, old);
  const current = scan.begin();
  expect(await readReviewEntries(['new'], async name => name, current)).toEqual(['new']);
  release('old');
  expect(await pending).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(1);
});

it('keeps reads bounded and invalidates work when its view is disposed', async () => {
  const scan = createReviewScan();
  let active = 0, peak = 0;
  const values = await readReviewEntries(['a', 'missing', 'b'], async name => {
    peak = Math.max(peak, ++active);
    await Promise.resolve(); active--;
    return name === 'missing' ? undefined : name;
  }, scan.begin());
  expect(peak).toBe(1);
  expect(values).toEqual(['a', 'b']);
  const current = scan.begin();
  scan.invalidate();
  const read = vi.fn(async () => 'stale');
  expect(await readReviewEntries(['a'], read, current)).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});
