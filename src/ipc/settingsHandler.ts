import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import * as edTool from '../js/rpgmv/edtool.js';
import Themes from '../js/rpgmv/styles'
import { getMainWindow, sendError, worked, getSettings, storage } from './shared';
import { loadRoute } from './viteHelper';
import { appCtx } from '../appContext';

ipcMain.on('settings', () => {
  appCtx.settingsWindow = new BrowserWindow({
    width: 800,
    height: 900,
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
  })
  appCtx.settingsWindow.setMenu(null)
  loadRoute(appCtx.settingsWindow, '/settings')
  appCtx.settingsWindow.webContents.on('did-finish-load', function () {
    appCtx.settingsWindow!.show();
  });
})

ipcMain.on('settingsReady', () => {
  if (appCtx.settingsWindow && !appCtx.settingsWindow.isDestroyed()) {
    appCtx.settingsWindow.webContents.send('settings', getSettings());
  }
})

ipcMain.on('applysettings', (ev, arg) => {
  appCtx.settings = {...appCtx.settings, ...arg}
  storage.set('settings', JSON.stringify(appCtx.settings))
  appCtx.settings.themeData = (Themes as Record<string, Record<string, string>>)[appCtx.settings.theme]
  const { llmApiKey, ...safeSettings } = appCtx.settings;
  getMainWindow().webContents.send('getGlobalSettings', safeSettings);
  if (appCtx.settingsWindow && !appCtx.settingsWindow.isDestroyed()) {
    appCtx.settingsWindow.close()
  }
  worked()
})

ipcMain.on('closesettings', () => {
  if (appCtx.settingsWindow && !appCtx.settingsWindow.isDestroyed()) {
    appCtx.settingsWindow.close()
  }
  worked()
})

ipcMain.on('gamePatcher', (ev, dir) => {
  if(!edTool.exists(dir)){
    sendError('추출된 파일이 없습니다')
    worked()
    return
  }
  appCtx.settingsWindow = new BrowserWindow({
    width: 800,
    height: 400,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png'),
  })
  appCtx.settingsWindow.setMenu(null)
  loadRoute(appCtx.settingsWindow, '/game-patcher')
  appCtx.settingsWindow.webContents.on('did-finish-load', function () {
    appCtx.settingsWindow!.show();
    appCtx.settingsWindow!.webContents.send('settings', getSettings());
  });
  appCtx.settingsWindow.on('close', function() {
    worked()
  });
  appCtx.settingsWindow!.show()
})
