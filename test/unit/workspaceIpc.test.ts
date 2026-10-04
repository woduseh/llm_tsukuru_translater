import path from 'path';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../src/appContext';
import { registerToolsHandlers } from '../../src/ipc/toolsHandler';
import { registerSettingsHandlers } from '../../src/ipc/settingsHandler';
import { registerTranslateHandlers } from '../../src/ipc/translateHandler';

const mocks = vi.hoisted(() => ({
  on: vi.fn(), handle: vi.fn(), createWindow: vi.fn(), write: vi.fn(),
  storageSet: vi.fn(), trans: vi.fn(), validate: vi.fn(),
  worked: vi.fn(), shellOpenPath: vi.fn().mockResolvedValue(''),
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  ipcMain: { on: mocks.on, handle: mocks.handle }, BrowserWindow: mocks.createWindow, shell: { openPath: mocks.shellOpenPath },
}));
vi.mock('../../src/ipc/shared', () => ({
  storage: { set: mocks.storageSet }, worked: mocks.worked, sendError: vi.fn(),
}));
vi.mock('../../src/ipc/viteHelper', () => ({ loadRoute: vi.fn() }));
vi.mock('../../src/ts/rpgmv/projectConvert', () => ({ ConvertProject: vi.fn() }));
vi.mock('../../src/ts/rpgmv/edtool.js', () => ({ exists: vi.fn() }));
vi.mock('../../src/ts/rpgmv/translator', () => ({ trans: mocks.trans, validateTranslatedFileContent: vi.fn() }));
vi.mock('../../src/ts/libs/translatorFactory', () => ({ createTranslator: vi.fn(), getLlmReadinessError: vi.fn() }));
vi.mock('../../src/ts/rpgmv/verifyWrite', () => ({ applyVerifiedJsonWrite: mocks.write }));
vi.mock('../../src/ts/libs/guidelineGenerator', () => ({ generateGuidelineDraft: vi.fn() }));
vi.mock('../../src/ts/libs/projectProfile', () => ({ scanProjectTranslationProfile: vi.fn() }));
vi.mock('../../src/ipc/llmProjectPathValidation', () => ({
  coerceLlmProjectArg: (arg: unknown) => arg, validateLlmProjectPath: mocks.validate,
}));
vi.mock('../../src/logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));

const invoke = (channel: string, sender: unknown, arg?: unknown) => {
  const entry = mocks.on.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`Missing handler: ${channel}`);
  return entry[1]({ sender }, arg);
};

let fixtureRoot: string;
let gameDir: string;
let otherGameDir: string;
function setup() {
  const ctx = new AppContext();
  ctx.allowedProjectRoots = [gameDir, otherGameDir];
  const win = { webContents: { send: vi.fn(), getURL: vi.fn(() => 'file:///app/index.html#/mvmz') }, isDestroyed: () => false, close: vi.fn(), focus: vi.fn() };
  ctx.mainWindow = win as unknown as Electron.BrowserWindow;
  registerToolsHandlers(ctx);
  registerSettingsHandlers(ctx);
  registerTranslateHandlers(ctx);
  return { ctx, win, sender: win.webContents };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockReset();
  const parent = path.resolve('artifacts/unit/workspaceIpc');
  fs.mkdirSync(parent, { recursive: true });
  fixtureRoot = fs.mkdtempSync(path.join(parent, 'case-'));
  gameDir = path.join(fixtureRoot, 'game');
  otherGameDir = path.join(fixtureRoot, 'other-game');
  fs.mkdirSync(gameDir); fs.mkdirSync(otherGameDir);
});
afterEach(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

describe('inline workspace IPC', () => {
  it.each(['openLLMCompare', 'openJsonVerify'])('does not grant an unselected project through %s', open => {
    const { ctx, sender } = setup();
    ctx.allowedProjectRoots = [gameDir];
    invoke(open, sender, otherGameDir);
    expect(sender.send).toHaveBeenCalledWith('alert', expect.objectContaining({ icon: 'error' }));
    expect(sender.send.mock.calls.some(([channel]) => ['set-allowed-paths', 'replace-allowed-paths', 'workspaceNavigate'].includes(channel))).toBe(false);
    expect(mocks.createWindow).not.toHaveBeenCalled();
  });

  it.each([
    ['openLLMCompare', 'compareReady', 'initCompare', '/llm-compare'],
    ['openJsonVerify', 'verifyReady', 'initVerify', '/json-verify'],
  ])('routes %s into main and only initializes changed projects', (open, ready, init, route) => {
    const { win, sender } = setup();
    const dir = gameDir;
    invoke(open, sender, dir);
    expect(sender.send).toHaveBeenCalledWith('workspaceNavigate', { route });
    expect(mocks.createWindow).not.toHaveBeenCalled();
    invoke(ready, {});
    expect(sender.send).not.toHaveBeenCalledWith(init, dir);
    invoke(ready, sender);
    expect(sender.send).toHaveBeenCalledWith('set-allowed-paths', [dir]);
    expect(sender.send).toHaveBeenCalledWith(init, dir);
    sender.send.mockClear();
    invoke(open, sender, dir);
    invoke(ready, sender);
    expect(sender.send.mock.calls.filter(([channel]) => channel === init)).toHaveLength(0);
    const nextDir = otherGameDir;
    invoke(open, sender, nextDir);
    invoke(ready, sender);
    expect(sender.send).toHaveBeenCalledWith(init, nextDir);
    expect(win.close).not.toHaveBeenCalled();
  });

  it.each([
    ['openLLMCompare', 'compareReady', 'initCompare', '/llm-compare'],
    ['openJsonVerify', 'verifyReady', 'initVerify', '/json-verify'],
  ])('reinitializes fresh %s mounts and handles new directories on an already active route', (open, ready, init, route) => {
    const { sender } = setup();
    const dir = gameDir;
    invoke(open, sender, dir);
    invoke(ready, sender, { fresh: true });
    sender.send.mockClear();
    // The old component was discarded by the project-keyed KeepAlive cache.
    // Returning to the same directory still needs to initialize its new mount.
    invoke(open, sender, dir);
    invoke(ready, sender, { fresh: true });
    expect(sender.send).toHaveBeenCalledWith(init, dir);
    sender.send.mockClear();
    invoke(ready, sender);
    expect(sender.send.mock.calls.filter(([channel]) => channel === init)).toHaveLength(0);
    sender.getURL.mockReturnValue(`file:///app/index.html#${route}`);
    const nextDir = otherGameDir;
    invoke(open, sender, nextDir);
    expect(sender.send).toHaveBeenCalledWith(init, nextDir);
    sender.send.mockClear();
    invoke(open, sender, nextDir);
    expect(sender.send.mock.calls.filter(([channel]) => channel === init)).toHaveLength(0);
  });

  it('keeps JSON writes scoped to the selected inline project and sender', () => {
    const { sender } = setup();
    const dir = gameDir;
    invoke('openJsonVerify', sender, dir);
    invoke('verifyReady', sender);
    const request = { requestId: 'save-1', fileName: 'Map001.json', targetPath: path.join(dir, 'Map001.json'), expectedContent: '{}', nextContent: '{"x":1}' };
    invoke('verifyApplyJson', {}, request);
    expect(mocks.write).not.toHaveBeenCalled();
    invoke('verifyApplyJson', sender, request);
    expect(mocks.write).toHaveBeenCalledWith(dir, expect.objectContaining({ expectedContent: '{}', nextContent: '{"x":1}' }));
    expect(sender.send).toHaveBeenCalledWith('verifyApplyJsonDone', expect.objectContaining({ requestId: 'save-1', success: true }));
  });

  it.each([
    ['settings', 'settingsReady', 'settings', 'closesettings', '/settings', undefined],
    ['openLLMSettings', 'llmSettingsReady', 'llmSettings', 'llmSettingsClose', '/llm-settings', { dir: 'game', game: 'wolf' }],
  ])('opens and closes %s without closing the application', (open, ready, state, close, route, arg) => {
    const { win, sender } = setup();
    invoke(open as string, sender, arg);
    expect(sender.send).toHaveBeenCalledWith('workspaceNavigate', { route });
    sender.send.mockClear();
    invoke(ready as string, {});
    expect(sender.send).not.toHaveBeenCalled();
    invoke(ready as string, sender);
    expect(sender.send).toHaveBeenCalledWith(state, expect.any(Object));
    invoke(close as string, sender);
    expect(sender.send).toHaveBeenCalledWith('workspaceNavigate', { route: 'back' });
    expect(win.close).not.toHaveBeenCalled();
    expect(mocks.createWindow).not.toHaveBeenCalled();
  });

  it('starts translation and navigates back to its engine without closing main', () => {
    const { win, sender } = setup();
    const dir = gameDir;
    mocks.validate.mockReturnValue({ dir, game: 'wolf' });
    invoke('openLLMSettings', sender, { dir, game: 'wolf' });
    invoke('llmSettingsApply', sender, { llmParallelWorkers: 2 });
    expect(sender.send).toHaveBeenCalledWith('llmSettingsApplyResult', { success: true });
    expect(sender.send).toHaveBeenCalledWith('workspaceNavigate', { route: '/wolf' });
    expect(mocks.trans).toHaveBeenCalledOnce();
    expect(win.close).not.toHaveBeenCalled();
  });

  it('acknowledges saved settings and leaves main alive', () => {
    const { ctx, win, sender } = setup();
    invoke('settings', sender);
    invoke('applysettings', sender, { llmModel: 'chosen-model' });
    expect(sender.send).toHaveBeenCalledWith('settingsSaved', ctx.settings);
    expect(sender.send).toHaveBeenCalledWith('workspaceNavigate', { route: 'back' });
    expect(win.close).not.toHaveBeenCalled();
  });

  it.each([
    ['closesettings', undefined],
    ['applysettings', { llmModel: 'chosen-model' }],
    ['applysettings', { llmChunkSize: -1 }],
  ])('does not release project work when inline settings finish via %s (%j)', (channel, arg) => {
    const { sender } = setup();
    invoke('settings', sender);
    expect(mocks.worked).not.toHaveBeenCalled();
    invoke(channel as string, sender, arg);
    expect(mocks.worked).not.toHaveBeenCalled();
  });

  it('still unlocks the project after closing a standalone settings window', () => {
    const { ctx } = setup();
    const popup = { webContents: { send: vi.fn() }, isDestroyed: () => false, close: vi.fn() };
    ctx.settingsWindow = popup as unknown as Electron.BrowserWindow;
    invoke('closesettings', popup.webContents);
    expect(popup.close).toHaveBeenCalledOnce();
    expect(mocks.worked).toHaveBeenCalledWith(ctx);
  });

  it('releases settings submission after invalid input without navigating away', () => {
    const { sender } = setup();
    invoke('settings', sender);
    sender.send.mockClear();
    invoke('applysettings', sender, { llmChunkSize: -1 });
    expect(sender.send).toHaveBeenCalledWith('settingsSaveFailed');
    expect(sender.send.mock.calls.filter(([channel]) => channel === 'workspaceNavigate')).toHaveLength(0);
    expect(mocks.storageSet).not.toHaveBeenCalled();
  });

  it('preserves runtime settings and releases submission when persistence fails', () => {
    const { ctx, sender } = setup();
    invoke('settings', sender);
    ctx.settings.llmModel = 'saved-model';
    const before = ctx.settings;
    sender.send.mockClear();
    mocks.storageSet.mockImplementationOnce(() => { throw new Error('disk full'); });
    invoke('applysettings', sender, { llmModel: 'draft-model' });
    expect(ctx.settings).toBe(before);
    expect(ctx.settings.llmModel).toBe('saved-model');
    expect(sender.send).toHaveBeenCalledWith('settingsSaveFailed');
    expect(sender.send.mock.calls.some(([channel]) => ['settingsSaved', 'workspaceNavigate'].includes(channel))).toBe(false);
  });

  it('does not start translation or replace runtime options when settings persistence fails', () => {
    const { ctx, sender } = setup();
    ctx.settings.llmParallelWorkers = 1;
    const before = ctx.settings;
    mocks.validate.mockReturnValue({ dir: gameDir, game: 'wolf' });
    invoke('openLLMSettings', sender, { dir: gameDir, game: 'wolf' });
    sender.send.mockClear();
    mocks.storageSet.mockImplementationOnce(() => { throw new Error('disk full'); });
    invoke('llmSettingsApply', sender, { llmParallelWorkers: 4 });
    expect(ctx.settings).toBe(before);
    expect(ctx.settings.llmParallelWorkers).toBe(1);
    expect(sender.send).toHaveBeenCalledWith('llmSettingsApplyResult', { success: false });
    expect(mocks.trans).not.toHaveBeenCalled();
    expect(sender.send.mock.calls.some(([channel]) => channel === 'workspaceNavigate')).toBe(false);
  });

  it('keeps the original custom prompt when guideline persistence fails', async () => {
    const { ctx } = setup();
    ctx.settings.llmCustomPrompt = 'original prompt';
    const before = ctx.settings;
    mocks.storageSet.mockImplementationOnce(() => { throw new Error('disk full'); });
    const apply = mocks.handle.mock.calls.find(([channel]) => channel === 'applyGuidelineDraft')![1];
    await expect(apply({}, { guideline: 'new guideline', mode: 'append' })).rejects.toThrow('disk full');
    expect(ctx.settings).toBe(before);
    expect(ctx.settings.llmCustomPrompt).toBe('original prompt');
  });

  it('releases translation submission after invalid project without starting work', () => {
    const { sender } = setup();
    mocks.validate.mockImplementation(() => { throw new Error('invalid project'); });
    invoke('openLLMSettings', sender, { dir: 'game', game: 'wolf' });
    sender.send.mockClear();
    invoke('llmSettingsApply', sender, {});
    expect(sender.send).toHaveBeenCalledWith('llmSettingsApplyResult', { success: false });
    expect(mocks.trans).not.toHaveBeenCalled();
    expect(sender.send.mock.calls.filter(([channel]) => channel === 'workspaceNavigate')).toHaveLength(0);
  });

  it('opens folders through Electron shell only for the main renderer and valid paths', () => {
    const { sender } = setup();
    invoke('openFolder', {}, '/outside');
    invoke('openFolder', sender, '');
    expect(mocks.shellOpenPath).not.toHaveBeenCalled();
    invoke('openFolder', sender, path.resolve('game'));
    expect(mocks.shellOpenPath).toHaveBeenCalledWith(path.resolve('game'));
  });

});
