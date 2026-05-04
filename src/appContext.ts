import { BrowserWindow } from 'electron';
import { AppSettings } from './types/settings';
import { ExtractedFileData } from './ts/rpgmv/types';
import type { extData, wolfMetadata } from './ts/wolf/types';
import type { TerminalService } from './agent/terminalService';

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
  allowedProjectRoots: string[] = [];
  terminalProjectRoots: string[] = [];
  currentTerminalProjectRoot = '';
  terminalService: TerminalService | null = null;
  WolfExtData: extData[] = [];
  WolfCache: Record<string, Buffer> = {};
  WolfMetadata: wolfMetadata = { ver: -1 };

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
    this.allowedProjectRoots = [];
    this.terminalProjectRoots = [];
    this.currentTerminalProjectRoot = '';
    this.terminalService = null;
    this.WolfExtData = [];
    this.WolfCache = {};
    this.WolfMetadata = { ver: -1 };
  }
}

/** Singleton instance for backward compatibility (used by tests) */
export const appCtx = new AppContext();
