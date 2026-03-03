import { BrowserWindow } from 'electron';
import { AppSettings } from './types/settings';
import { ExtractedFileData } from './js/rpgmv/types';

export class AppContext {
  mainWindow: BrowserWindow | null = null;
  settingsWindow: BrowserWindow | null = null;
  settings: AppSettings = {} as AppSettings;
  gb: Record<string, ExtractedFileData> = {};
  externMsg: Record<string, string> = {};
  useExternMsg = false;
  externMsgKeys: string[] = [];
  llmAbort = false;
  oPath = '';
  sourceDir = '';
  WolfExtData: extData[] = [];  // extData from globals.d.ts
  WolfCache: Record<string, Buffer> = {};
  WolfMetadata: { ver: 2 | 3 | -1 } = { ver: -1 };

  /** Reset all state to defaults. Used for test isolation. */
  reset(): void {
    this.mainWindow = null;
    this.settingsWindow = null;
    this.settings = {} as AppSettings;
    this.gb = {};
    this.externMsg = {};
    this.useExternMsg = false;
    this.externMsgKeys = [];
    this.llmAbort = false;
    this.oPath = '';
    this.sourceDir = '';
    this.WolfExtData = [];
    this.WolfCache = {};
    this.WolfMetadata = { ver: -1 };
  }
}

/** Singleton instance for backward compatibility (used by tests) */
export const appCtx = new AppContext();
