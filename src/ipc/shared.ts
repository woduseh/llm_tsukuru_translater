import { app } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';
import tools from '../js/libs/projectTools'
import * as dataBaseO from '../js/rpgmv/datas.js';
import * as fs from 'fs';
import * as path from 'path';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';

function getEncryptionKey(): string {
  const keyPath = path.join(app.getPath('userData'), '.store-key');
  try {
    if (fs.existsSync(keyPath)) {
      const key = fs.readFileSync(keyPath, 'utf8').trim();
      if (key) return key;
    }
  } catch { /* generate new */ }
  const newKey = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(keyPath, newKey, 'utf8'); } catch {}
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
  let givensettings = {}

  if(storage.has('settings')){
    givensettings = JSON.parse(storage.get('settings') as string)
  }

  ctx.settings = dataBaseO.settings


  ctx.settings = {...ctx.settings, ...givensettings}
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
