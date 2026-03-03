import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import * as edTool from '../js/rpgmv/edtool.js';
import Themes from '../js/rpgmv/styles'
import { getMainWindow, sendError, worked, getSettings, storage } from './shared';

ipcMain.on('settings', () => {
  globalThis.settingsWindow = new BrowserWindow({
    width: 800,
    height: 900,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  })
  globalThis.settingsWindow.setMenu(null)
  globalThis.settingsWindow.loadFile('src/html/config/settings.html')
  globalThis.settingsWindow.webContents.on('did-finish-load', function () {
    globalThis.settingsWindow.show();
    globalThis.settingsWindow.webContents.send('settings', getSettings());
  });
  globalThis.settingsWindow.on('close', function() {
    worked()
  });
  globalThis.settingsWindow.show()
})

ipcMain.on('applysettings', async (ev, arg) => {
  globalThis.settings = {...globalThis.settings, ...arg}
  storage.set('settings', JSON.stringify(globalThis.settings))
  globalThis.settingsWindow.close()
  globalThis.settings.themeData = (Themes as Record<string, any>)[globalThis.settings.theme]
  const { llmApiKey, ...safeSettings } = globalThis.settings;
  getMainWindow().webContents.send('getGlobalSettings', safeSettings);
  worked()
})

ipcMain.on('closesettings', async (ev, arg) => {
  globalThis.settingsWindow.close()
  worked()
})

ipcMain.on('changeLang', (ev, arg) => {
  globalThis.settings.language = arg
  storage.set('settings', JSON.stringify(globalThis.settings))
  globalThis.mwindow.reload()
})

ipcMain.on('gamePatcher', (ev, dir) => {
  if(!edTool.exists(dir)){
    sendError('추출된 파일이 없습니다')
    worked()
    return
  }
  globalThis.settingsWindow = new BrowserWindow({
    width: 800,
    height: 400,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  })
  globalThis.settingsWindow.setMenu(null)
  globalThis.settingsWindow.loadFile('src/html/patcher/index.html')
  globalThis.settingsWindow.webContents.on('did-finish-load', function () {
    globalThis.settingsWindow.show();
    globalThis.settingsWindow.webContents.send('settings', getSettings());
  });
  globalThis.settingsWindow.on('close', function() {
    worked()
  });
  globalThis.settingsWindow.show()
})
