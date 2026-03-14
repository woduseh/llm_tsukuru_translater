import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import * as edTool from '../ts/rpgmv/edtool.js';
import Themes from '../ts/rpgmv/styles'
import { sendError, worked, getSettings, storage } from './shared';
import { loadRoute } from './viteHelper';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';

export function registerSettingsHandlers(ctx: AppContext) {
  ipcMain.on('settings', () => {
    ctx.settingsWindow = new BrowserWindow({
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
      icon: path.join(PROJECT_ROOT, 'res', 'icon.png'),
    })
    ctx.settingsWindow.setMenu(null)
    loadRoute(ctx.settingsWindow, '/settings')
    ctx.settingsWindow.webContents.on('did-finish-load', function () {
      ctx.settingsWindow!.show();
    });
  })

  ipcMain.on('settingsReady', () => {
    if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
      ctx.settingsWindow.webContents.send('settings', getSettings(ctx));
    }
  })

  ipcMain.on('applysettings', (ev, arg) => {
    ctx.settings = {...ctx.settings, ...arg}
    storage.set('settings', JSON.stringify(ctx.settings))
    ctx.settings.themeData = (Themes as Record<string, Record<string, string>>)[ctx.settings.theme]
    const { llmApiKey: _llmApiKey, ...safeSettings } = ctx.settings;
    ctx.mainWindow!.webContents.send('getGlobalSettings', safeSettings);
    if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
      ctx.settingsWindow.close()
    }
    worked(ctx)
  })

  ipcMain.on('closesettings', () => {
    if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
      ctx.settingsWindow.close()
    }
    worked(ctx)
  })

  ipcMain.on('gamePatcher', (ev, dir) => {
    if(!edTool.exists(dir)){
      sendError(ctx, '추출된 파일이 없습니다')
      worked(ctx)
      return
    }
    ctx.settingsWindow = new BrowserWindow({
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
      icon: path.join(PROJECT_ROOT, 'res', 'icon.png'),
    })
    ctx.settingsWindow.setMenu(null)
    loadRoute(ctx.settingsWindow, '/game-patcher')
    ctx.settingsWindow.webContents.on('did-finish-load', function () {
      ctx.settingsWindow!.show();
      ctx.settingsWindow!.webContents.send('settings', getSettings(ctx));
    });
    ctx.settingsWindow.on('close', function() {
      worked(ctx)
    });
    ctx.settingsWindow!.show()
  })
}
