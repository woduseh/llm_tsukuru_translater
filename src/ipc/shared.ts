import { app } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';
import tools from '../ts/libs/projectTools'
import Themes from '../ts/rpgmv/styles'
import * as fs from 'fs';
import * as path from 'path';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';
import log from '../logger';
import { sanitizeStoredSettings } from '../ts/libs/settingsRuntimeValidation';

function getEncryptionKey(): string {
  const keyPath = path.join(app.getPath('userData'), '.store-key');
  try {
    if (fs.existsSync(keyPath)) {
      const key = fs.readFileSync(keyPath, 'utf8').trim();
      if (key) return key;
    }
  } catch { /* generate new */ }
  const newKey = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(keyPath, newKey, 'utf8'); } catch { /* ignore write failure — key stays in memory */ }
  return newKey;
}

export const storage = new Store({ encryptionKey: getEncryptionKey() });
export const defaultHeight = 550;

export function sendAlert(ctx: AppContext, txt: string){
  ctx.mainWindow!.webContents.send('alert', txt);
}

export function sendError(ctx: AppContext, txt: string){
  ctx.mainWindow!.webContents.send('alert', {icon: 'error',  message: txt});
}

export function worked(ctx: AppContext){
  ctx.mainWindow!.webContents.send('worked', 0);
  ctx.mainWindow!.webContents.send('loading', 0);
}

export function getSettings(ctx: AppContext){
  return ctx.settings
}

export async function loadSettings(ctx: AppContext){
  let givensettings: unknown = {}

  if(storage.has('settings')){
    try {
      givensettings = JSON.parse(storage.get('settings') as string)
    } catch (error) {
      log.warn('Failed to parse stored settings, falling back to defaults.', error)
    }
  }

  ctx.settings = sanitizeStoredSettings(givensettings)
  ctx.settings.themeList = Object.keys(Themes)
  ctx.settings.themeData = (Themes as Record<string, Record<string, string>>)[ctx.settings.theme] ?? {}
  ctx.settings.version = app.getVersion()
  storage.set('settings', JSON.stringify(ctx.settings))
}

export function setOPath(ctx: AppContext){
  if(tools.packed){
    ctx.oPath = process.resourcesPath
  }
  else{
    ctx.oPath = PROJECT_ROOT
  }
}
