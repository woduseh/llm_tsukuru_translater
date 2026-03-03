import log from './src/logger';

import { app, BrowserWindow, ipcMain } from 'electron';
import { apply } from "./src/ts/rpgmv/apply";
import { createWindow, registerWindowHandlers } from './src/ipc/windowManager';
import { registerExtractHandlers } from './src/ipc/extractHandler';
import { registerSettingsHandlers } from './src/ipc/settingsHandler';
import { registerTranslateHandlers } from './src/ipc/translateHandler';
import { registerToolsHandlers } from './src/ipc/toolsHandler';
import { registerWolfHandlers } from './src/ts/wolf/main';
import { initFontIPC } from './src/ts/rpgmv/fonts';
import { initExtentions } from './src/ts/libs/extentions';
import { AppContext } from './src/appContext';

const ctx = new AppContext();

registerWindowHandlers(ctx);
registerExtractHandlers(ctx);
registerSettingsHandlers(ctx);
registerTranslateHandlers(ctx);
registerToolsHandlers(ctx);
registerWolfHandlers(ctx);
initFontIPC();

ipcMain.on('apply', (ev, arg) => apply(ev, arg, ctx));

app.whenReady().then(() => {
  createWindow(ctx)
  initExtentions(ctx)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ctx)
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', function (err) {
  log.error('Uncaught exception:', err);
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
})