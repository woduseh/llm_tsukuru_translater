import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import open from 'open';
import * as prjc from '../js/rpgmv/projectConvert';

let llmCompareWindow: Electron.BrowserWindow | null = null;
let jsonVerifyWindow: Electron.BrowserWindow | null = null;

export function getLLMCompareWindow(): Electron.BrowserWindow | null {
  return llmCompareWindow;
}

ipcMain.on('openLLMCompare', (ev, dir: string) => {
  if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
    llmCompareWindow.webContents.send('initCompare', dir);
    llmCompareWindow.focus();
    return;
  }
  llmCompareWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  });
  llmCompareWindow.setMenu(null);
  llmCompareWindow.loadFile('src/html/llm-compare/index.html');
  llmCompareWindow.webContents.on('did-finish-load', () => {
    llmCompareWindow!.show();
    llmCompareWindow!.webContents.send('initCompare', dir);
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

ipcMain.on('openJsonVerify', (ev, dir: string) => {
  if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
    jsonVerifyWindow.webContents.send('initVerify', dir);
    jsonVerifyWindow.focus();
    return;
  }
  jsonVerifyWindow = new BrowserWindow({
    width: 900,
    height: 700,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  });
  jsonVerifyWindow.setMenu(null);
  jsonVerifyWindow.loadFile('src/html/json-verify/index.html');
  jsonVerifyWindow.webContents.on('did-finish-load', () => {
    jsonVerifyWindow!.show();
    jsonVerifyWindow!.webContents.send('verifySettings', globalThis.settings);
    jsonVerifyWindow!.webContents.send('initVerify', dir);
  });
  jsonVerifyWindow.on('closed', () => {
    jsonVerifyWindow = null;
  });
})

ipcMain.on('openFolder', (ev, arg) => {
  open(arg)
})

ipcMain.on('log', async(ev, arg) => console.log(arg))
ipcMain.on('projectConvert', async(ev, arg) => prjc.ConvertProject(arg))
