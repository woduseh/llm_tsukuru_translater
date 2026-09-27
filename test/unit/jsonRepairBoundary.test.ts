import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../src/appContext';
import { registerToolsHandlers } from '../../src/ipc/toolsHandler';
import { settings } from '../../src/ts/rpgmv/datas';
const mocks = vi.hoisted(() => ({ on: vi.fn(), handle: vi.fn() }));
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() },
  ipcMain: { on: mocks.on, handle: mocks.handle }, BrowserWindow: vi.fn(),
}));
vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('../../src/ts/rpgmv/projectConvert', () => ({ ConvertProject: vi.fn() }));
vi.mock('../../src/ipc/viteHelper', () => ({ loadRoute: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('JSON repair through its real IPC and provider boundaries', () => {
  it.each(['Hello', 'Hello\n', '\nHello', '\nHello\n\n', '  Hello  ', 'Hello %1 \\V[2]'])('preserves exact structure for %j', async original => {
    const ctx = new AppContext();
    ctx.settings = { ...settings, llmProvider: 'gemini', llmApiKey: 'fixture-key', llmModel: 'fixture' };
    const sender = { send: vi.fn(), getURL: () => 'file:///fixture/#/mvmz' };
    ctx.mainWindow = { webContents: sender, isDestroyed: () => false } as unknown as Electron.BrowserWindow;
    registerToolsHandlers(ctx);
    mocks.on.mock.calls.find(([name]) => name === 'openJsonVerify')![1]({ sender }, process.cwd());
    const translated = original.replace('Hello', '안녕');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: translated }] } }] } });
    await mocks.on.mock.calls.find(([name]) => name === 'verifyLlmRepair')![1]({ sender }, {
      requestId: 'whitespace', items: [{ path: '$.name', origText: original }],
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith('verifyLlmRepairDone', {
      requestId: 'whitespace', success: true, results: [{ path: '$.name', origText: original, newText: translated }],
    });
  });
});
