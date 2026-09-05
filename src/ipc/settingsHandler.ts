import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import * as edTool from '../ts/rpgmv/edtool.js';
import Themes from '../ts/rpgmv/styles'
import { sanitizeSettingsForRenderer } from '../ts/libs/llmProviderConfig';
import { applyValidatedSettingsUpdate } from '../ts/libs/settingsRuntimeValidation';
import { sendError, worked, storage } from './shared';
import { loadRoute } from './viteHelper';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';

export function registerSettingsHandlers(ctx: AppContext) {
  const closeSettings = () => {
    if (!ctx.settingsWindow || ctx.settingsWindow.isDestroyed()) return;
    if (ctx.settingsWindow === ctx.mainWindow) {
      ctx.settingsWindow.webContents.send('workspaceNavigate', { route: 'back' });
    } else ctx.settingsWindow.close();
  };

  ipcMain.on('settings', (ev) => {
    if (ctx.mainWindow && ev.sender === ctx.mainWindow.webContents) {
      ctx.settingsWindow = ctx.mainWindow;
      ctx.mainWindow.webContents.send('workspaceNavigate', { route: '/settings' });
      return;
    }
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
    // Unlock the parent page on any close path (native X, Alt+F4, programmatic),
    // not only when the in-page 취소/적용 buttons fire applysettings/closesettings.
    ctx.settingsWindow.on('closed', () => worked(ctx))
    loadRoute(ctx.settingsWindow, '/settings')
    ctx.settingsWindow.webContents.on('did-finish-load', function () {
      ctx.settingsWindow!.show();
    });
  })

  ipcMain.on('settingsReady', (ev) => {
    if (ev.sender !== ctx.settingsWindow?.webContents) return;
    if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
      ctx.settingsWindow.webContents.send('settings', ctx.settings);
    }
  })

  ipcMain.on('applysettings', (ev, arg) => {
    if (ctx.settingsWindow && ev.sender !== ctx.settingsWindow.webContents) return;
    try {
      ctx.settings = applyValidatedSettingsUpdate(ctx.settings, arg)
    } catch (error) {
      ev.sender.send('settingsSaveFailed');
      sendError(ctx, (error as Error).message)
      if (ev.sender !== ctx.mainWindow?.webContents) worked(ctx)
      return
    }
    storage.set('settings', JSON.stringify(ctx.settings))
    ctx.settings.themeData = (Themes as Record<string, Record<string, string>>)[ctx.settings.theme] ?? {}
    ev.sender.send('settingsSaved', ctx.settings);
    ctx.mainWindow!.webContents.send('getGlobalSettings', sanitizeSettingsForRenderer(ctx.settings));
    closeSettings()
    if (ev.sender !== ctx.mainWindow?.webContents) worked(ctx)
  })

  ipcMain.on('closesettings', (ev) => {
    if (ev.sender !== ctx.settingsWindow?.webContents) return;
    closeSettings()
    if (ev.sender !== ctx.mainWindow?.webContents) worked(ctx)
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
      ctx.settingsWindow!.webContents.send('settings', ctx.settings);
    });
    ctx.settingsWindow.on('close', function() {
      worked(ctx)
    });
    ctx.settingsWindow!.show()
  })
}
