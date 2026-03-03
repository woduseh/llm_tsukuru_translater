import { BrowserWindow } from 'electron';
import { AppSettings } from './types/settings';
import { ExtractedFileData } from './js/rpgmv/types';

export interface AppContextType {
  mainWindow: BrowserWindow | null;
  settingsWindow: BrowserWindow | null;
  settings: AppSettings;
  gb: Record<string, ExtractedFileData>;
  externMsg: Record<string, string>;
  useExternMsg: boolean;
  externMsgKeys: string[];
  llmAbort: boolean;
  oPath: string;
  sourceDir: string;
  iconPath: string;
  keyvalue: CryptoKey | undefined;
  loadEn: (() => void) | null;
  WolfExtData: extData[];  // extData from globals.d.ts
  WolfEncoding: 'utf8' | 'shift-jis';
  WolfCache: Record<string, Buffer>;
  WolfMetadata: { ver: 2 | 3 | -1 };
  [key: string]: unknown;
}

export const appCtx: AppContextType = {
  mainWindow: null,
  settingsWindow: null,
  settings: {} as AppSettings,
  gb: {},
  externMsg: {},
  useExternMsg: false,
  externMsgKeys: [],
  llmAbort: false,
  oPath: '',
  sourceDir: '',
  iconPath: '',
  keyvalue: undefined,
  loadEn: null,
  WolfExtData: [],
  WolfEncoding: 'utf8',
  WolfCache: {},
  WolfMetadata: { ver: -1 },
};

// Backward compat: sync globalThis with appCtx for gradual migration
function syncToGlobal() {
  const g = globalThis as Record<string, unknown>;
  const propertyMap: Record<string, keyof AppContextType> = {
    mwindow: 'mainWindow',
    settingsWindow: 'settingsWindow',
    settings: 'settings',
    gb: 'gb',
    externMsg: 'externMsg',
    useExternMsg: 'useExternMsg',
    externMsgKeys: 'externMsgKeys',
    llmAbort: 'llmAbort',
    oPath: 'oPath',
    sourceDir: 'sourceDir',
    iconPath: 'iconPath',
    keyvalue: 'keyvalue',
    loadEn: 'loadEn',
    WolfExtData: 'WolfExtData',
    WolfEncoding: 'WolfEncoding',
    WolfCache: 'WolfCache',
    WolfMetadata: 'WolfMetadata',
  };
  for (const [globalName, ctxName] of Object.entries(propertyMap)) {
    Object.defineProperty(g, globalName, {
      get: () => (appCtx as Record<string, unknown>)[ctxName],
      set: (v: unknown) => { (appCtx as Record<string, unknown>)[ctxName] = v; },
      configurable: true
    });
  }
}

export function initAppContext() {
  syncToGlobal();
}
