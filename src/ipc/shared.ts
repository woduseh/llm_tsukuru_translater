import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import tools from '../js/libs/projectTools'
import * as dataBaseO from '../js/rpgmv/datas.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function getEncryptionKey(): string {
  const keyPath = path.join(app.getPath('userData'), '.store-key');
  try {
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }
  } catch { /* generate new */ }
  // Use old hardcoded key as initial value for migration compatibility
  const newKey = 'tsukuru-extractor-store-key';
  try { fs.writeFileSync(keyPath, newKey, 'utf8'); } catch {}
  return newKey;
}

export const storage = new Store({ encryptionKey: getEncryptionKey() });
export const defaultHeight = 550;

let mainid = 0;

export function getMainId(): number {
  return mainid;
}

export function setMainId(id: number): void {
  mainid = id;
}

export const getMainWindow = (): BrowserWindow => {
  const ID = mainid * 1;
  return BrowserWindow.fromId(ID)!;
}

export function sendAlert(txt: string){
  getMainWindow().webContents.send('alert', txt);
}

export function sendError(txt: string){
  getMainWindow().webContents.send('alert', {icon: 'error',  message: txt});
}

export function worked(){
  getMainWindow().webContents.send('worked', 0);
  getMainWindow().webContents.send('loading', 0);
}

export function getSettings(){
  return globalThis.settings
}

export async function loadSettings(){
  let givensettings = {}

  if(storage.has('settings')){
    givensettings = JSON.parse(storage.get('settings') as string)
  }

  globalThis.settings = dataBaseO.settings


  globalThis.settings = {...globalThis.settings, ...givensettings}
  globalThis.settings.version = app.getVersion()
  storage.set('settings', JSON.stringify(globalThis.settings))
}

export function setOPath(){
  if(tools.packed){
    globalThis.oPath = process.resourcesPath
  }
  else{
    globalThis.oPath = __dirname.replace(/[/\\]src[/\\]ipc$/, '')
  }
}
