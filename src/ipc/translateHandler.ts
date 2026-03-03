import { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import * as eztrans from '../js/rpgmv/translator.js';
import { getMainWindow, storage } from './shared';
import { getLLMCompareWindow } from './toolsHandler';

let llmSettingsWindow: Electron.BrowserWindow | null = null;
let llmPendingArg: any = null;

ipcMain.on('eztrans', eztrans.trans)

ipcMain.on('openLLMSettings', (ev, arg) => {
  llmPendingArg = arg;
  if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
    llmSettingsWindow.focus();
    return;
  }
  llmSettingsWindow = new BrowserWindow({
    width: 550,
    height: 300,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  });
  llmSettingsWindow.setMenu(null);
  llmSettingsWindow.loadFile('src/html/llm/index.html');
  llmSettingsWindow.webContents.on('did-finish-load', () => {
    llmSettingsWindow!.show();
    llmSettingsWindow!.webContents.send('llmSettings', globalThis.settings);
  });
  llmSettingsWindow.on('closed', () => {
    llmSettingsWindow = null;
  });
})

ipcMain.on('llmSettingsApply', (ev, data) => {
  globalThis.settings = { ...globalThis.settings, llmSortOrder: data.llmSortOrder };
  storage.set('settings', JSON.stringify(globalThis.settings));

  if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
    llmSettingsWindow.close();
  }

  if (llmPendingArg) {
    globalThis.llmAbort = false;
    const a = {
      dir: Buffer.from(llmPendingArg.dir, 'utf8').toString('base64'),
      type: 'gemini',
      langu: globalThis.settings.llmSourceLang || 'ja',
      game: llmPendingArg.game,
      resetProgress: data.llmResetProgress || false,
      sortOrder: data.llmSortOrder || 'name-asc',
      translationMode: data.llmTranslationMode || 'untranslated'
    };
    getMainWindow().webContents.send('loading', 1);
    eztrans.trans(null, a);
    llmPendingArg = null;
  }
})

ipcMain.on('abortLLM', () => {
  globalThis.llmAbort = true;
})

ipcMain.on('llmSettingsClose', () => {
  if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
    llmSettingsWindow.close();
  }
})

ipcMain.on('retranslateFile', async (_ev, data: { dir: string; fileName: string }) => {
  const wolfEdir = path.join(data.dir, '_Extract', 'Texts');
  const mvEdir = path.join(data.dir, 'Extract');
  const edir = (fs.existsSync(wolfEdir) && fs.existsSync(wolfEdir + '_backup')) ? wolfEdir : mvEdir;
  globalThis.llmAbort = false;
  try {
    const result = await eztrans.retranslateFile(
      edir,
      data.fileName,
      globalThis.settings.llmSourceLang || 'ja',
      globalThis.settings.llmTargetLang || 'ko',
      (msg: string) => {
        const lcw = getLLMCompareWindow();
        if (lcw && !lcw.isDestroyed()) {
          lcw.webContents.send('retranslateProgress', msg);
        }
      }
    );
    const lcw = getLLMCompareWindow();
    if (lcw && !lcw.isDestroyed()) {
      lcw.webContents.send('retranslateFileDone', result);
    }
  } catch (err: any) {
    const lcw = getLLMCompareWindow();
    if (lcw && !lcw.isDestroyed()) {
      lcw.webContents.send('retranslateFileDone', { success: false, error: err.message || String(err) });
    }
  }
})

ipcMain.on('retranslateBlocks', async (_ev, data: { dir: string; fileName: string; blockIndices: number[] }) => {
  const wolfEdir = path.join(data.dir, '_Extract', 'Texts');
  const mvEdir = path.join(data.dir, 'Extract');
  const edir = (fs.existsSync(wolfEdir) && fs.existsSync(wolfEdir + '_backup')) ? wolfEdir : mvEdir;
  globalThis.llmAbort = false;
  try {
    const result = await eztrans.retranslateBlocks(
      edir,
      data.fileName,
      data.blockIndices,
      globalThis.settings.llmSourceLang || 'ja',
      globalThis.settings.llmTargetLang || 'ko',
      (msg: string) => {
        const lcw = getLLMCompareWindow();
        if (lcw && !lcw.isDestroyed()) {
          lcw.webContents.send('retranslateProgress', msg);
        }
      }
    );
    const lcw = getLLMCompareWindow();
    if (lcw && !lcw.isDestroyed()) {
      lcw.webContents.send('retranslateBlocksDone', result);
    }
  } catch (err: any) {
    const lcw = getLLMCompareWindow();
    if (lcw && !lcw.isDestroyed()) {
      lcw.webContents.send('retranslateBlocksDone', { success: false, error: err.message || String(err) });
    }
  }
})
