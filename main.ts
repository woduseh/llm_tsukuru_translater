import log from './src/logger';

import { app, BrowserWindow, ipcMain } from 'electron';
import { apply } from "./src/ts/rpgmv/apply";
import { createWindow, registerWindowHandlers } from './src/ipc/windowManager';
import { registerExtractHandlers } from './src/ipc/extractHandler';
import { registerSettingsHandlers } from './src/ipc/settingsHandler';
import { registerTranslateHandlers } from './src/ipc/translateHandler';
import { registerToolsHandlers } from './src/ipc/toolsHandler';
import { registerTerminalHandlers } from './src/ipc/terminalHandler';
import { registerWolfHandlers } from './src/ts/wolf/main';
import { initFontIPC } from './src/ts/rpgmv/fonts';
import { initExtentions } from './src/ts/libs/extentions';
import { AppContext } from './src/appContext';
import { maybeRunUiHarness } from './src/harness/uiHarness';
import { TerminalService } from './src/agent/terminalService';

const ctx = new AppContext();
const terminalService = new TerminalService(ctx);

registerWindowHandlers(ctx);
registerExtractHandlers(ctx);
registerSettingsHandlers(ctx);
registerTranslateHandlers(ctx);
registerToolsHandlers(ctx);
registerTerminalHandlers(ctx, terminalService);
registerWolfHandlers(ctx);
initFontIPC();

ipcMain.on('apply', (ev, arg) => apply(ev, arg, ctx));

app.whenReady().then(() => {
  createWindow(ctx)
  initExtentions(ctx)
  void maybeRunUiHarness(ctx)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ctx)
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  terminalService.disposeAll('app-before-quit');
})

process.on('uncaughtException', function (err) {
  log.error('Uncaught exception:', err);
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
})
