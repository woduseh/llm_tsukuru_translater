import { app, BrowserWindow, ipcMain, dialog, globalShortcut } from 'electron';
import fs from 'fs';
import path from 'path';
import tools from '../js/libs/projectTools'
import Themes from '../js/rpgmv/styles'
import { getMainWindow, sendAlert, sendError, worked, loadSettings, setOPath, defaultHeight, setMainId } from './shared';
import { loadRoute } from './viteHelper';
import { appCtx } from '../appContext';

export function createWindow() {
  loadSettings()
  setOPath()
  const mainWindow = new BrowserWindow({
    width: 800,
    height: defaultHeight,
    show: false,
    resizable: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    icon: path.join(__dirname, '../../res/icon.png')
  })
  
  mainWindow.setMenu(null)
  loadRoute(mainWindow, '/')
  mainWindow.webContents.on('did-finish-load', function () {
    const initialPaths = [
      app.getPath('userData'),
      app.getAppPath(),
      path.join(app.getAppPath(), 'res'),
    ];
    mainWindow.webContents.send('set-allowed-paths', initialPaths);
    mainWindow.show();
    if(!tools.packed){
      globalShortcut.register('Control+Shift+I', () => {
        mainWindow.webContents.openDevTools()
        return false;
      });
    }
  });
  setMainId(mainWindow.id);
  appCtx.mainWindow = mainWindow
  mainWindow.on('close', () => {
    app.quit()
  })
  tools.init()
}

ipcMain.on('mainReady', () => {
  appCtx.settings.themeData = (Themes as Record<string, Record<string, string>>)[appCtx.settings.theme]
  const { llmApiKey, ...safeSettings } = appCtx.settings;
  getMainWindow().webContents.send('getGlobalSettings', safeSettings);
})

ipcMain.on('license', () => {
  const licenseWindow = new BrowserWindow({
    width: 800,
    height: 400,
    resizable: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../res/icon.png')
  })
  licenseWindow.setMenu(null)
  licenseWindow.loadFile('src/html/license.html')
  licenseWindow.show()
})

ipcMain.on('changeURL', (ev, arg) => {
  loadRoute(appCtx.mainWindow!, arg);
})

ipcMain.on('minimize', () => {
  getMainWindow().minimize()
})

ipcMain.on('close', () => {
  getMainWindow().close()
})

ipcMain.on('setheight', (ev,arg) =>{
  appCtx.mainWindow!.setResizable(true);
  appCtx.mainWindow!.setSize(800, arg, false)
  appCtx.mainWindow!.setResizable(false)
})

ipcMain.on('app_version', (event) => {
  event.sender.send('app_version', { version: app.getVersion() });
});

ipcMain.on('select_folder', async (ev, typeo) => {
  let Path = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if(!Path.canceled){
    const qs = Path.filePaths[0]
    let qv
    if(qs.includes('\\')){
      qv = qs.split('\\')[qs.split('\\').length-1]
    }
    else{
      qv = qs.split('/')[qs.split('/').length-1]
    }
    let dir = qs
    if(qv === 'data'){
      getMainWindow().webContents.send('set_path', {type:typeo, dir:dir});
      getMainWindow().webContents.send('set-allowed-paths', [dir]);
    }
    else{
      if(fs.existsSync(path.join(qs, 'www', 'data'))){
        getMainWindow().webContents.send('set_path', {type:typeo, dir:path.join(qs, 'www', 'data')});
        getMainWindow().webContents.send('set-allowed-paths', [path.join(qs, 'www', 'data')]);
      }
      else if(fs.existsSync(path.join(qs, 'data'))){
        getMainWindow().webContents.send('set_path', {type:typeo, dir:path.join(qs, 'data')});
        getMainWindow().webContents.send('set-allowed-paths', [path.join(qs, 'data')]);
      }
      else if(fs.existsSync(path.join(qs, 'Data.wolf'))){
        getMainWindow().webContents.send('set_path', {type:typeo, dir:path.join(qs)});
        getMainWindow().webContents.send('set-allowed-paths', [path.join(qs)]);
      }
      else{
        getMainWindow().webContents.send('alert', {icon: 'error',  message:'폴더가 올바르지 않습니다'});
      }
    }
  }
});
