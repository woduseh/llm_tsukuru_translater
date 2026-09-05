import { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import * as eztrans from '../ts/rpgmv/translator.js';
import { buildLlmStartWindowState } from '../ts/libs/llmProviderConfig';
import { normalizeTranslationConcurrency, normalizeTranslationRpm } from '../ts/libs/translationRequestScheduler';
import { generateGuidelineDraft } from '../ts/libs/guidelineGenerator';
import { scanProjectTranslationProfile, type ProjectTranslationProfile } from '../ts/libs/projectProfile';
import { storage } from './shared';
import { getLLMCompareWindow } from './toolsHandler';
import { loadRoute } from './viteHelper';
import log from '../logger';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';
import { coerceLlmProjectArg, validateLlmProjectPath, type LlmProjectArg } from './llmProjectPathValidation';

export function registerTranslateHandlers(ctx: AppContext) {
  let llmSettingsWindow: Electron.BrowserWindow | null = null;
  let llmPendingArg: LlmProjectArg | null = null;
  let guidelineGenerationAbort = false;

  const closeSettings = (route = 'back') => {
    if (!llmSettingsWindow || llmSettingsWindow.isDestroyed()) return;
    if (llmSettingsWindow === ctx.mainWindow) {
      llmSettingsWindow.webContents.send('workspaceNavigate', { route });
    } else llmSettingsWindow.close();
  };

  ipcMain.on('openLLMSettings',(ev, arg) => {
    try {
      llmPendingArg = coerceLlmProjectArg(arg);
    } catch (err: unknown) {
      ctx.mainWindow?.webContents.send('alert', { icon: 'error', message: (err as Error).message || String(err) });
      return;
    }
    if (ctx.mainWindow && ev.sender === ctx.mainWindow.webContents) {
      llmSettingsWindow = ctx.mainWindow;
      ctx.mainWindow.webContents.send('workspaceNavigate', { route: '/llm-settings' });
      return;
    }
    if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
      llmSettingsWindow.focus();
      return;
    }
    llmSettingsWindow = new BrowserWindow({
      width: 550,
      height: 760,
      resizable: true,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, '..', 'preload.js')
      },
      icon: path.join(PROJECT_ROOT, 'res', 'icon.png'),
    });
    llmSettingsWindow.setMenu(null);
    loadRoute(llmSettingsWindow, '/llm-settings');
    llmSettingsWindow.webContents.on('did-finish-load', () => {
      llmSettingsWindow!.show();
    });
    llmSettingsWindow.on('closed', () => {
      llmSettingsWindow = null;
    });
  })

  ipcMain.on('llmSettingsReady', (ev) => {
    if (ev.sender !== llmSettingsWindow?.webContents) return;
    if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
      llmSettingsWindow.webContents.send('llmSettings', buildLlmStartWindowState(ctx.settings));
    }
  })

  ipcMain.on('llmSettingsApply', (ev, data) => {
    if (llmSettingsWindow && ev.sender !== llmSettingsWindow.webContents) return;
    const llmParallelWorkers = normalizeTranslationConcurrency(data?.llmParallelWorkers);
    const llmRequestsPerMinute = normalizeTranslationRpm(data?.llmRequestsPerMinute);
    ctx.settings = { ...ctx.settings, llmSortOrder: data?.llmSortOrder, llmParallelWorkers, llmRequestsPerMinute };
    storage.set('settings', JSON.stringify(ctx.settings));

    if (llmPendingArg) {
      let validatedProject;
      try {
        validatedProject = validateLlmProjectPath(llmPendingArg, { allowedRoots: ctx.allowedProjectRoots });
      } catch (err: unknown) {
        log.warn('Blocked LLM translation for invalid project path:', err);
        ctx.mainWindow?.webContents.send('alert', { icon: 'error', message: (err as Error).message || String(err) });
        ev.sender.send('llmSettingsApplyResult', { success: false });
        return;
      }
      ev.sender.send('llmSettingsApplyResult', { success: true });
      closeSettings(`/${validatedProject.game}`);
      ctx.llmAbort = false;
      const a = {
        dir: Buffer.from(validatedProject.dir, 'utf8').toString('base64'),
        langu: ctx.settings.llmSourceLang || 'ja',
        game: validatedProject.game,
        resetProgress: data.llmResetProgress || false,
        sortOrder: data.llmSortOrder || 'name-asc',
        parallelWorkers: llmParallelWorkers,
        translationMode: data.llmTranslationMode || 'untranslated'
      };
      ctx.mainWindow!.webContents.send('loading', 1);
      eztrans.trans(null, a, ctx);
      llmPendingArg = null;
    } else {
      ev.sender?.send('llmSettingsApplyResult', { success: true });
      closeSettings();
    }
  })

  ipcMain.handle('scanGuidelineProfile', async () => {
    if (!llmPendingArg?.dir) {
      throw new Error('프로젝트 경로가 없어 지침 프로필을 스캔할 수 없습니다.');
    }
    const validatedProject = validateLlmProjectPath(llmPendingArg, { allowedRoots: ctx.allowedProjectRoots });
    return scanProjectTranslationProfile(validatedProject.dir, {
      maxFiles: 220,
      maxDirectoryEntries: 4000,
      maxSamplesPerBucket: 24,
      maxTerms: 48,
      maxRepeatedPhrases: 24,
      maxCandidates: 32,
    });
  })

  ipcMain.handle('generateGuidelineDraft', async (_ev, data: { profile?: ProjectTranslationProfile }) => {
    if (!data?.profile) {
      throw new Error('먼저 프로젝트 프로필을 스캔해주세요.');
    }
    guidelineGenerationAbort = false;
    const result = await generateGuidelineDraft(data.profile, ctx.settings, {
      sourceLang: ctx.settings.llmSourceLang || 'ja',
      targetLang: ctx.settings.llmTargetLang || 'ko',
      existingCustomPrompt: ctx.settings.llmCustomPrompt || '',
      isAborted: () => guidelineGenerationAbort || !!ctx.llmAbort,
    });
    return result;
  })

  ipcMain.handle('applyGuidelineDraft', async (_ev, data: { guideline?: string; mode?: 'append' | 'replace' }) => {
    const guideline = typeof data?.guideline === 'string' ? data.guideline.trim() : '';
    if (!guideline) {
      throw new Error('반영할 번역 지침이 비어 있습니다.');
    }
    const mode = data?.mode === 'replace' ? 'replace' : 'append';
    const currentPrompt = ctx.settings.llmCustomPrompt || '';
    const nextPrompt = mode === 'replace'
      ? guideline
      : [currentPrompt.trim(), guideline].filter(Boolean).join('\n\n');
    ctx.settings = { ...ctx.settings, llmCustomPrompt: nextPrompt };
    storage.set('settings', JSON.stringify(ctx.settings));
    return {
      success: true,
      llmCustomPrompt: nextPrompt,
    };
  })

  ipcMain.on('cancelGuidelineGeneration', () => {
    guidelineGenerationAbort = true;
  })

  ipcMain.on('abortLLM', () => {
    ctx.llmAbort = true;
  })

  ipcMain.on('llmSettingsClose', (ev) => {
    if (ev.sender !== llmSettingsWindow?.webContents) return;
    closeSettings();
  })

  interface RetranslateRequest {
    dir: string;
    fileName: string;
    requestId?: string;
    expectedContent?: string;
  }

  async function retranslate(
    sender: Electron.WebContents,
    data: RetranslateRequest,
    doneChannel: 'retranslateFileDone' | 'retranslateBlocksDone',
    translate: (extractDir: string, onProgress: (message: string) => void) => Promise<{ success: boolean; error?: string }>,
  ): Promise<void> {
    // Capture the request's target before awaiting the provider. A newly opened
    // compare surface must never receive another window's in-flight result.
    const win = getLLMCompareWindow();
    if (!win || win.isDestroyed() || sender !== win.webContents) return;
    const send = (channel: 'retranslateProgress' | typeof doneChannel, payload: object) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, { ...payload, requestId: data.requestId, fileName: data.fileName });
      }
    };
    try {
      const wolfDir = path.join(data.dir, '_Extract', 'Texts');
      const extractDir = fs.existsSync(wolfDir) && fs.existsSync(wolfDir + '_backup')
        ? wolfDir
        : path.join(data.dir, 'Extract');
      const result = await translate(extractDir, (message) => send('retranslateProgress', { message }));
      send(doneChannel, result);
    } catch (err: unknown) {
      log.error('Retranslation failed:', err);
      send(doneChannel, { success: false, error: (err as Error).message || String(err) });
    }
  }

  ipcMain.on('retranslateFile', (ev, data: RetranslateRequest) => {
    return retranslate(ev.sender, data, 'retranslateFileDone', (extractDir, onProgress) => eztrans.retranslateFile(
      extractDir,
      data.fileName,
      ctx.settings.llmSourceLang || 'ja',
      ctx.settings.llmTargetLang || 'ko',
      ctx,
      onProgress,
      data.expectedContent,
    ));
  });

  ipcMain.on('retranslateBlocks', (ev, data: RetranslateRequest & { blockIndices: number[] }) => {
    return retranslate(ev.sender, data, 'retranslateBlocksDone', (extractDir, onProgress) => eztrans.retranslateBlocks(
      extractDir,
      data.fileName,
      data.blockIndices,
      ctx.settings.llmSourceLang || 'ja',
      ctx.settings.llmTargetLang || 'ko',
      ctx,
      onProgress,
      data.expectedContent,
    ));
  });
}
