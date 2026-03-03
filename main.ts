import { initAppContext } from './src/appContext';
initAppContext();

import { app, BrowserWindow, ipcMain } from 'electron';
import * as applyjs from "./src/js/rpgmv/apply.js";
import { createWindow } from './src/ipc/windowManager';
import './src/ipc/extractHandler';
import './src/ipc/settingsHandler';
import './src/ipc/translateHandler';
import './src/ipc/toolsHandler';
import { wolfInit } from './src/js/wolf/main.js';
import { initFontIPC } from './src/js/rpgmv/fonts';
import { initExtentions } from './src/js/libs/extentions';

export { worked } from './src/ipc/shared';

ipcMain.on('apply', applyjs.apply)

app.whenReady().then(() => {
  createWindow()
  initExtentions()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', function (err) {
  console.log(err);
})

wolfInit()
initFontIPC()