import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {} }));
vi.mock('../../src/logger', () => ({ default: {} }));
import { captureScreen } from '../../src/harness/uiHarness';

const scratch = path.resolve('artifacts/unit/ui-capture');
const roots: string[] = [];
function directory(): string {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'run-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    expect(path.dirname(fs.realpathSync(root))).toBe(fs.realpathSync(scratch));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('waits for the first nonempty compositor frame and writes only that capture', async () => {
  vi.useFakeTimers();
  const root = directory();
  const bytes = Buffer.from('captured image fixture');
  const capturePage = vi.fn()
    .mockResolvedValueOnce({ isEmpty: () => true })
    .mockResolvedValue({ isEmpty: () => false, toPNG: () => bytes });
  const result = captureScreen({ webContents: {
    capturePage, executeJavaScript: vi.fn().mockResolvedValue(null),
  } } as unknown as BrowserWindow, root, 'home');
  await vi.advanceTimersByTimeAsync(100);
  expect(fs.readFileSync(await result)).toEqual(bytes);
  expect(capturePage).toHaveBeenCalledTimes(2);
});

it('fails within the deadline when no frame can be captured and saves no empty image', async () => {
  vi.useFakeTimers();
  const root = directory();
  const capturePage = vi.fn().mockResolvedValue({ isEmpty: () => true });
  const result = captureScreen({ webContents: {
    capturePage, executeJavaScript: vi.fn().mockResolvedValue(null),
  } } as unknown as BrowserWindow, root, 'home', 200);
  const assertion = expect(result).rejects.toThrow('UI capture is empty after 200ms: home');
  await vi.advanceTimersByTimeAsync(200);
  await assertion;
  expect(fs.existsSync(path.join(root, 'home.png'))).toBe(false);
});
