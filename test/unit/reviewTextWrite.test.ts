import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyReviewedTextWrite } from '../../src/ts/rpgmv/reviewTextWrite';
import { runWithDirectoryLock } from '../../src/ts/libs/concurrency';
import { AppContext } from '../../src/appContext';
import { registerToolsHandlers } from '../../src/ipc/toolsHandler';
import * as atomic from '../../src/ts/libs/atomicFile';

const mocks = vi.hoisted(() => ({ on: vi.fn(), handle: vi.fn() }));
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() },
  ipcMain: { on: mocks.on, handle: mocks.handle }, BrowserWindow: vi.fn(),
}));
vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('../../src/ts/rpgmv/projectConvert', () => ({ ConvertProject: vi.fn() }));
vi.mock('../../src/ipc/viteHelper', () => ({ loadRoute: vi.fn() }));
const roots: string[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture(surface = 'Extract') {
  const parent = path.resolve('artifacts/unit/reviewTextWrite');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-')); roots.push(root);
  const dir = path.join(root, surface); fs.mkdirSync(dir, { recursive: true });
  const targetPath = path.join(dir, 'Map001.txt');
  const expectedContent = '\uFEFF--- 101-0 ---\r\nHello\r\n';
  fs.writeFileSync(targetPath, expectedContent);
  const request = { projectDir: root, fileName: 'Map001.txt', targetPath, expectedContent, nextContent: '--- 101-0 ---\n안녕\n\n' };
  return { root, dir, targetPath, request };
}
function setup() {
  const ctx = new AppContext();
  const sender = { send: vi.fn(), getURL: () => 'file:///fixture/index.html#/mvmz' };
  ctx.mainWindow = { webContents: sender, isDestroyed: () => false } as unknown as Electron.BrowserWindow;
  registerToolsHandlers(ctx);
  const open = (dir: string) => mocks.on.mock.calls.find(([name]) => name === 'openLLMCompare')![1]({ sender }, dir);
  const save = (request: unknown, caller: unknown = sender) => mocks.handle.mock.calls.find(([name]) => name === 'compareSaveText')![1]({ sender: caller }, request);
  return { open, save };
}

describe('manual review storage boundary', () => {
  it.each(['Extract', path.join('_Extract', 'Texts')])('allows explicit structural repair inside %s', async surface => {
    const f = fixture(surface); const ipc = setup(); ipc.open(f.root);
    expect(await ipc.save(f.request)).toEqual({ success: true });
    expect(fs.readFileSync(f.targetPath, 'utf8')).toBe(f.request.nextContent);
    expect(fs.readdirSync(f.dir)).toEqual(['Map001.txt']);
  });

  it('rejects stale preimages without losing the external edit', async () => {
    const f = fixture(); const ipc = setup(); ipc.open(f.root);
    fs.writeFileSync(f.targetPath, 'newer external edit');
    expect(await ipc.save(f.request)).toMatchObject({ success: false, error: expect.stringContaining('외부에서 변경') });
    expect(fs.readFileSync(f.targetPath, 'utf8')).toBe('newer external edit');
    expect(fs.readdirSync(f.dir)).toEqual(['Map001.txt']);
  });

  it('validates the selected project, sender, filename and destination', async () => {
    const f = fixture(); const other = fixture(); const ipc = setup(); ipc.open(f.root);
    expect((await ipc.save(f.request, {})).success).toBe(false);
    expect((await ipc.save(other.request)).success).toBe(false);
    expect((await ipc.save({ ...f.request, targetPath: other.targetPath })).success).toBe(false);
    expect((await ipc.save({ ...f.request, fileName: '../Map001.txt' })).success).toBe(false);
    expect((await ipc.save({ ...f.request, expectedContent: null })).success).toBe(false);
    expect(fs.readFileSync(f.targetPath, 'utf8')).toBe(f.request.expectedContent);
    expect(fs.readFileSync(other.targetPath, 'utf8')).toBe(other.request.expectedContent);
  });

  it('rechecks project ownership after waiting for the translation directory lock', async () => {
    const f = fixture(); const other = fixture(); const ipc = setup(); ipc.open(f.root);
    let release!: () => void;
    const active = runWithDirectoryLock(f.dir, () => new Promise<void>(resolve => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const pending = ipc.save(f.request);
    ipc.open(other.root);
    release(); await active;
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('프로젝트') });
    expect(fs.readFileSync(f.targetPath, 'utf8')).toBe(f.request.expectedContent);
  });

  it('keeps the original on storage failure and refuses backup or linked targets', () => {
    const f = fixture();
    const fail = vi.spyOn(atomic, 'atomicWriteTextFile').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => applyReviewedTextWrite(f.root, f.request)).toThrow('disk full'); fail.mockRestore();
    const backup = path.join(f.root, 'Extract_backup'); fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'Map001.txt'), 'backup');
    expect(() => applyReviewedTextWrite(f.root, { ...f.request, targetPath: path.join(backup, 'Map001.txt') })).toThrow(/경로 밖/);
    const linked = path.join(f.dir, 'Linked.txt');
    try { fs.symlinkSync(f.targetPath, linked); } catch (e) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code || '')) return; throw e; }
    expect(() => applyReviewedTextWrite(f.root, { ...f.request, targetPath: linked, fileName: 'Linked.txt' })).toThrow(/올바르지/);
    expect(fs.readFileSync(f.targetPath, 'utf8')).toBe(f.request.expectedContent);
  });
});
