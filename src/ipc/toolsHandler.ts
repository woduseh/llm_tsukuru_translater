import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import open from 'open';
import * as prjc from '../js/rpgmv/projectConvert';
import { createGeminiTranslator } from '../js/libs/geminiTranslator';
import { loadRoute } from './viteHelper';
import { appCtx } from '../appContext';

let llmCompareWindow: Electron.BrowserWindow | null = null;
let jsonVerifyWindow: Electron.BrowserWindow | null = null;
let pendingCompareDir: string | null = null;
let pendingVerifyDir: string | null = null;

export function getLLMCompareWindow(): Electron.BrowserWindow | null {
  return llmCompareWindow;
}

ipcMain.on('openLLMCompare', (ev, dir: string) => {
  if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
    llmCompareWindow.webContents.send('initCompare', dir);
    llmCompareWindow.focus();
    return;
  }
  pendingCompareDir = dir;
  llmCompareWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  });
  llmCompareWindow.setMenu(null);
  loadRoute(llmCompareWindow, '/llm-compare');
  llmCompareWindow.webContents.on('did-finish-load', () => {
    llmCompareWindow!.show();
  });
  llmCompareWindow.on('closed', () => {
    llmCompareWindow = null;
  });
})

ipcMain.on('llmCompareClose', () => {
  if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
    llmCompareWindow.close();
  }
})

ipcMain.on('compareReady', () => {
  if (pendingCompareDir && llmCompareWindow && !llmCompareWindow.isDestroyed()) {
    llmCompareWindow.webContents.send('set-allowed-paths', [pendingCompareDir]);
    llmCompareWindow.webContents.send('initCompare', pendingCompareDir);
    pendingCompareDir = null;
  }
})

ipcMain.on('openJsonVerify', (ev, dir: string) => {
  if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
    jsonVerifyWindow.webContents.send('initVerify', dir);
    jsonVerifyWindow.focus();
    return;
  }
  pendingVerifyDir = dir;
  jsonVerifyWindow = new BrowserWindow({
    width: 900,
    height: 700,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  });
  jsonVerifyWindow.setMenu(null);
  loadRoute(jsonVerifyWindow, '/json-verify');
  jsonVerifyWindow.webContents.on('did-finish-load', () => {
    jsonVerifyWindow!.show();
  });
  jsonVerifyWindow.on('closed', () => {
    jsonVerifyWindow = null;
  });
})

ipcMain.on('verifyReady', () => {
  if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
    jsonVerifyWindow.webContents.send('verifySettings', appCtx.settings);
    if (pendingVerifyDir) {
      jsonVerifyWindow.webContents.send('set-allowed-paths', [pendingVerifyDir]);
      jsonVerifyWindow.webContents.send('initVerify', pendingVerifyDir);
      pendingVerifyDir = null;
    }
  }
})

ipcMain.on('openFolder', (ev, arg) => {
  open(arg)
})

ipcMain.on('log', async(ev, arg) => console.log(arg))
ipcMain.on('projectConvert', async(ev, arg) => prjc.ConvertProject(arg))

// ── 줄밀림 LLM 재번역 ──
interface LlmRepairItem {
  path: string;
  origText: string;
}

ipcMain.on('verifyLlmRepair', async (_ev, items: LlmRepairItem[]) => {
  const win = jsonVerifyWindow;
  if (!win || win.isDestroyed()) return;
  const send = (ch: string, ...args: unknown[]) => {
    if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
  };

  const settings = appCtx.settings;
  if (!settings?.llmApiKey || !settings?.llmModel) {
    send('verifyLlmRepairDone', { success: false, error: 'LLM API 키 또는 모델이 설정되지 않았습니다.' });
    return;
  }

  try {
    const sourceLang = settings.llmSourceLang || settings.langu || 'ja';
    const targetLang = settings.llmTargetLang || 'ko';
    const gemini = createGeminiTranslator(settings, sourceLang, targetLang);
    const results: { path: string; origText: string; newText: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      send('verifyLlmRepairProgress', { current: i + 1, total: items.length, path: items[i].path });
      try {
        const translated = await gemini.translateText(items[i].origText);
        results.push({ path: items[i].path, origText: items[i].origText, newText: translated.trim() });
      } catch (e) {
        results.push({ path: items[i].path, origText: items[i].origText, newText: `[번역 실패: ${(e as Error).message}]` });
      }
    }

    send('verifyLlmRepairDone', { success: true, results });
  } catch (e) {
    send('verifyLlmRepairDone', { success: false, error: (e as Error).message });
  }
})
