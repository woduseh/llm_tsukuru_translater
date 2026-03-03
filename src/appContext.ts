import { BrowserWindow } from 'electron';
import { AppSettings } from './types/settings';

export interface AppContextType {
  mainWindow: BrowserWindow | null;
  settingsWindow: BrowserWindow | null;
  settings: AppSettings;
  gb: Record<string, any>;
  externMsg: Record<string, any>;
  useExternMsg: boolean;
  externMsgKeys: string[];
  llmAbort: boolean;
  oPath: string;
  sourceDir: string;
  iconPath: string;
  keyvalue: CryptoKey | undefined;
  loadEn: (() => void) | null;
  WolfExtData: any[];
  WolfEncoding: 'utf8' | 'shift-jis';
  WolfCache: Record<string, Buffer>;
  WolfMetadata: { ver: 2 | 3 | -1 };
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
  const g = globalThis as any;
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
      get: () => (appCtx as any)[ctxName],
      set: (v: any) => { (appCtx as any)[ctxName] = v; },
      configurable: true
    });
  }
}

export function initAppContext() {
  syncToGlobal();
}
