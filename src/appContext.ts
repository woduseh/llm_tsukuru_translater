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
  loadEn: (() => void) | null;
  WolfExtData: extData[];  // extData from globals.d.ts
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
  loadEn: null,
  WolfExtData: [],
  WolfCache: {},
  WolfMetadata: { ver: -1 },
};

export function initAppContext() {
  // No-op — kept for backward compatibility with main.ts call
}
