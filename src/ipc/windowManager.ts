import { app, BrowserWindow, ipcMain, dialog, globalShortcut } from 'electron';
import fs from 'fs';
import path from 'path';
import tools from '../ts/libs/projectTools'
import { sanitizeSettingsForRenderer } from '../ts/libs/llmProviderConfig';
import Themes from '../ts/rpgmv/styles'
import { loadSettings, setOPath, defaultHeight } from './shared';
import { loadRoute } from './viteHelper';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';
import { rememberAllowedProjectRoot } from './llmProjectPathValidation';

export function createWindow(ctx: AppContext) {
  loadSettings(ctx)
  setOPath(ctx)
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
    icon: path.join(PROJECT_ROOT, 'res', 'icon.png')
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
  ctx.mainWindow = mainWindow
  mainWindow.on('close', () => {
    app.quit()
  })
  tools.init(ctx)
}

export function registerWindowHandlers(ctx: AppContext) {
  ipcMain.on('mainReady', () => {
    ctx.settings.themeData = (Themes as Record<string, Record<string, string>>)[ctx.settings.theme]
    ctx.mainWindow!.webContents.send('getGlobalSettings', sanitizeSettingsForRenderer(ctx.settings));
  })

  ipcMain.on('license', () => {
    const licenseWindow = new BrowserWindow({
      width: 800,
      height: 400,
      resizable: true,
      autoHideMenuBar: true,
      icon: path.join(PROJECT_ROOT, 'res', 'icon.png')
    })
    licenseWindow.setMenu(null)
    licenseWindow.loadFile('src/html/license.html')
    licenseWindow.show()
  })

  ipcMain.on('changeURL', (ev, arg) => {
    loadRoute(ctx.mainWindow!, arg);
  })

  ipcMain.on('minimize', () => {
    ctx.mainWindow!.minimize()
  })

  ipcMain.on('close', () => {
    ctx.mainWindow!.close()
  })

  ipcMain.on('setheight', (ev,arg) =>{
    ctx.mainWindow!.setResizable(true);
    ctx.mainWindow!.setSize(800, arg, false)
    ctx.mainWindow!.setResizable(false)
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
        rememberTrustedProjectPaths(ctx, dir, inferTerminalProjectRoot(dir));
        ctx.mainWindow!.webContents.send('set_path', {type:typeo, dir:dir});
        ctx.mainWindow!.webContents.send('set-allowed-paths', [dir]);
      }
      else{
        if(fs.existsSync(path.join(qs, 'www', 'data'))){
          const projectDir = path.join(qs, 'www', 'data');
          rememberTrustedProjectPaths(ctx, projectDir, qs);
          ctx.mainWindow!.webContents.send('set_path', {type:typeo, dir:projectDir});
          ctx.mainWindow!.webContents.send('set-allowed-paths', [projectDir]);
        }
        else if(fs.existsSync(path.join(qs, 'data'))){
          const projectDir = path.join(qs, 'data');
          rememberTrustedProjectPaths(ctx, projectDir, qs);
          ctx.mainWindow!.webContents.send('set_path', {type:typeo, dir:projectDir});
          ctx.mainWindow!.webContents.send('set-allowed-paths', [projectDir]);
        }
        else if(fs.existsSync(path.join(qs, 'Data.wolf'))){
          rememberTrustedProjectPaths(ctx, qs, qs);
          ctx.mainWindow!.webContents.send('set_path', {type:typeo, dir:path.join(qs)});
          ctx.mainWindow!.webContents.send('set-allowed-paths', [path.join(qs)]);
        }
        else{
          ctx.mainWindow!.webContents.send('alert', {icon: 'error',  message:'폴더가 올바르지 않습니다'});
        }
      }
    }
  });
}

function rememberTrustedProjectPaths(ctx: AppContext, dataRoot: string, terminalRoot: string): void {
  const previousCurrentRoot = ctx.currentTerminalProjectRoot;
  if (previousCurrentRoot && path.resolve(previousCurrentRoot).toLowerCase() !== path.resolve(terminalRoot).toLowerCase()) {
    ctx.terminalService?.disposeAll('project-change');
  }
  ctx.allowedProjectRoots = rememberAllowedProjectRoot(ctx.allowedProjectRoots, dataRoot);
  ctx.terminalProjectRoots = rememberAllowedProjectRoot(ctx.terminalProjectRoots, terminalRoot);
  ctx.currentTerminalProjectRoot = terminalRoot;
}

function inferTerminalProjectRoot(dataRoot: string): string {
  const normalized = path.resolve(dataRoot);
  const base = path.basename(normalized).toLowerCase();
  if (base !== 'data') return normalized;
  const parent = path.dirname(normalized);
  if (path.basename(parent).toLowerCase() === 'www') {
    return path.dirname(parent);
  }
  return parent;
}
