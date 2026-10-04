import { applyReviewedTextWrite, resolveReviewTextTarget, type ReviewedTextWriteRequest, type ReviewedTextWriteResult } from '../ts/rpgmv/reviewTextWrite';
import { runWithDirectoryLock, normalizeDirectoryLockKey } from '../ts/libs/concurrency';
import { BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import * as prjc from '../ts/rpgmv/projectConvert';
import { buildVerifyWindowState } from '../ts/libs/llmProviderConfig';
import { createTranslator, getLlmReadinessError } from '../ts/libs/translatorFactory';
import { validateTranslatedFileContent } from '../ts/rpgmv/translator';
import { loadRoute } from './viteHelper';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';
import { AtomicFilePreimageMismatchError, AtomicFileWriteError } from '../ts/libs/atomicFile';
import { applyVerifiedJsonWrite } from '../ts/rpgmv/verifyWrite';
import { resolveGrantedReviewProject } from './reviewProjectAccess';
import type { LlmRepairRequest, VerifyApplyJsonRequest } from '../types/ipc';

let llmCompareWindow: Electron.BrowserWindow | null = null;
interface CompareBinding {
  readonly window: Electron.BrowserWindow;
  readonly projectDir: string;
  readonly isCurrent: () => boolean;
}
let compareBinding: CompareBinding | null = null;

export function getLLMCompareBinding(): CompareBinding | null {
  return compareBinding;
}

export function registerToolsHandlers(ctx: AppContext) {
  llmCompareWindow = null;
  compareBinding = null;
  let jsonVerifyWindow: Electron.BrowserWindow | null = null;
  let pendingCompareDir: string | null = null;
  let activeCompareDir: string | null = null;
  let pendingVerifyDir: string | null = null;
  let activeVerifyDir: string | null = null;
  let verifySelectionRevision = ctx.projectSelectionRevision;

  const bindCompare = (win: Electron.BrowserWindow, projectDir: string) => {
    if (compareBinding?.window === win && compareBinding.projectDir === projectDir && compareBinding.isCurrent()) return;
    const selectionRevision = ctx.projectSelectionRevision;
    const binding: CompareBinding = {
      window: win, projectDir,
      isCurrent: () => compareBinding === binding && !win.isDestroyed()
        && ctx.projectSelectionRevision === selectionRevision,
    };
    compareBinding = binding;
  };
  const grantedDirectory = (sender: Electron.WebContents, dir: unknown): string | undefined => {
    try { return resolveGrantedReviewProject(ctx, dir); }
    catch (error) {
      sender.send('alert', { icon: 'error', message: error instanceof Error ? error.message : '검수 프로젝트를 열지 못했습니다.' });
      return;
    }
  };

  const isMainRoute = (route: string) => ctx.mainWindow?.webContents.getURL().split('#')[1]?.split('?')[0] === route;
  const initializeCompare = (fresh = false) => {
    const dir = pendingCompareDir ?? (fresh ? activeCompareDir : null);
    if (dir && llmCompareWindow && !llmCompareWindow.isDestroyed()) {
      llmCompareWindow.webContents.send(llmCompareWindow === ctx.mainWindow ? 'set-allowed-paths' : 'replace-allowed-paths', [dir]);
      llmCompareWindow.webContents.send('initCompare', dir);
      pendingCompareDir = null;
    }
  };
  const initializeVerify = (fresh = false) => {
    const dir = pendingVerifyDir ?? (fresh ? activeVerifyDir : null);
    if (dir && jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
      jsonVerifyWindow.webContents.send(jsonVerifyWindow === ctx.mainWindow ? 'set-allowed-paths' : 'replace-allowed-paths', [dir]);
      jsonVerifyWindow.webContents.send('initVerify', dir);
      pendingVerifyDir = null;
    }
  };

  ipcMain.on('openLLMCompare', (ev, dir: string) => {
    const granted = grantedDirectory(ev.sender, dir);
    if (!granted) return;
    dir = granted;
    if (ctx.mainWindow && ev.sender === ctx.mainWindow.webContents) {
      if (llmCompareWindow !== ctx.mainWindow || activeCompareDir !== dir || !compareBinding?.isCurrent()) {
        pendingCompareDir = dir;
        activeCompareDir = path.resolve(dir);
      }
      llmCompareWindow = ctx.mainWindow;
      bindCompare(llmCompareWindow, dir);
      if (isMainRoute('/llm-compare')) initializeCompare();
      ctx.mainWindow.webContents.send('workspaceNavigate', { route: '/llm-compare' });
      return;
    }
    activeCompareDir = path.resolve(dir);
    if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
      bindCompare(llmCompareWindow, dir);
      llmCompareWindow.webContents.send('replace-allowed-paths', [dir]);
      llmCompareWindow.webContents.send('initCompare', dir);
      llmCompareWindow.focus();
      return;
    }
    pendingCompareDir = dir;
    llmCompareWindow = new BrowserWindow({
      width: 1100,
      height: 750,
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
    llmCompareWindow.setMenu(null);
    bindCompare(llmCompareWindow, dir);
    loadRoute(llmCompareWindow, '/llm-compare');
    llmCompareWindow.webContents.on('did-finish-load', () => {
      llmCompareWindow!.show();
    });
    llmCompareWindow.on('closed', () => {
      llmCompareWindow = null;
      compareBinding = null;
    });
  })

  ipcMain.on('llmCompareClose', (ev) => {
    if (ev.sender !== llmCompareWindow?.webContents) return;
    if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
      if (llmCompareWindow === ctx.mainWindow) {
        llmCompareWindow.webContents.send('workspaceNavigate', { route: 'back' });
      } else llmCompareWindow.close();
    }
  })

  ipcMain.on('compareReady', (ev, options?: { fresh?: boolean }) => {
    if (ev.sender !== llmCompareWindow?.webContents || !compareBinding?.isCurrent()) return;
    initializeCompare(options?.fresh === true);
  })

  ipcMain.on('openJsonVerify', (ev, dir: string) => {
    const granted = grantedDirectory(ev.sender, dir);
    if (!granted) return;
    dir = granted;
    const selectionChanged = verifySelectionRevision !== ctx.projectSelectionRevision;
    verifySelectionRevision = ctx.projectSelectionRevision;
    if (ctx.mainWindow && ev.sender === ctx.mainWindow.webContents) {
      if (jsonVerifyWindow !== ctx.mainWindow || activeVerifyDir !== dir || selectionChanged) {
        pendingVerifyDir = dir;
      }
      activeVerifyDir = path.resolve(dir);
      jsonVerifyWindow = ctx.mainWindow;
      if (isMainRoute('/json-verify')) initializeVerify();
      ctx.mainWindow.webContents.send('workspaceNavigate', { route: '/json-verify' });
      return;
    }
    activeVerifyDir = path.resolve(dir);
    if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
      jsonVerifyWindow.webContents.send('replace-allowed-paths', [dir]);
      jsonVerifyWindow.webContents.send('initVerify', dir);
      jsonVerifyWindow.focus();
      return;
    }
    pendingVerifyDir = dir;
    jsonVerifyWindow = new BrowserWindow({
      width: 900,
      height: 700,
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
    jsonVerifyWindow.setMenu(null);
    loadRoute(jsonVerifyWindow, '/json-verify');
    jsonVerifyWindow.webContents.on('did-finish-load', () => {
      jsonVerifyWindow!.show();
    });
    jsonVerifyWindow.on('closed', () => {
      jsonVerifyWindow = null;
      activeVerifyDir = null;
      pendingVerifyDir = null;
    });
  })

  ipcMain.on('verifyReady', (ev, options?: { fresh?: boolean }) => {
    if (ev.sender !== jsonVerifyWindow?.webContents || verifySelectionRevision !== ctx.projectSelectionRevision) return;
    if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
      jsonVerifyWindow.webContents.send('verifySettings', buildVerifyWindowState(ctx.settings));
      initializeVerify(options?.fresh === true);
    }
  })

  ipcMain.handle('compareSaveText', async (ev, request: ReviewedTextWriteRequest): Promise<ReviewedTextWriteResult> => {
    const binding = compareBinding;
    const projectDir = binding?.projectDir;
    const current = () => !!binding && binding.isCurrent() && ev.sender === binding.window.webContents;
    if (!current() || !projectDir || typeof request?.projectDir !== 'string'
      || normalizeDirectoryLockKey(request.projectDir) !== normalizeDirectoryLockKey(projectDir)
      || typeof request.targetPath !== 'string' || typeof request.fileName !== 'string'
      || typeof request.expectedContent !== 'string' || typeof request.nextContent !== 'string') {
      return { success: false, error: '텍스트 검수 저장 요청 또는 활성 프로젝트가 올바르지 않습니다.' };
    }
    try {
      resolveGrantedReviewProject(ctx, projectDir);
      const target = resolveReviewTextTarget(projectDir, request.targetPath, request.fileName);
      return await runWithDirectoryLock(path.dirname(target), () => {
        if (!current()) return { success: false, error: '프로젝트가 변경되어 저장하지 않았습니다.' };
        // Revalidate the destination after waiting for a translation operation to finish.
        applyReviewedTextWrite(projectDir, request);
        return { success: true };
      });
    } catch (error) {
      const conflict = error instanceof AtomicFileWriteError && error.cause instanceof AtomicFilePreimageMismatchError;
      return { success: false, error: conflict
        ? '파일이 외부에서 변경되어 저장하지 않았습니다. 편집 내용을 보관한 뒤 디스크에서 다시 읽어 주세요.'
        : error instanceof Error ? error.message : '텍스트 검수 저장에 실패했습니다.' };
    }
  });

  ipcMain.on('openFolder', (ev, arg) => {
    if (ev.sender !== ctx.mainWindow?.webContents || typeof arg !== 'string' || !arg.trim()) return;
    void shell.openPath(arg);
  })

  ipcMain.on('projectConvert', async(ev, arg) => prjc.ConvertProject(arg, ctx))

  ipcMain.on('verifyApplyJson', (ev, request: VerifyApplyJsonRequest) => {
    const win = jsonVerifyWindow;
    if (!win || win.isDestroyed()) return;
    const requestId = typeof request?.requestId === 'string' && request.requestId.length <= 128
      ? request.requestId
      : '';
    const fileName = typeof request?.fileName === 'string' ? request.fileName : '';
    const targetPath = typeof request?.targetPath === 'string' ? request.targetPath : '';
    const expectedContent = typeof request?.expectedContent === 'string' ? request.expectedContent : null;
    const nextContent = typeof request?.nextContent === 'string' ? request.nextContent : null;
    const sendResult = (success: boolean, error?: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send('verifyApplyJsonDone', {
          requestId,
          fileName,
          targetPath,
          success,
          error,
        });
      }
    };

    if (ev.sender !== win.webContents
      || !requestId
      || !fileName
      || !targetPath
      || expectedContent === null
      || nextContent === null
      || !activeVerifyDir || verifySelectionRevision !== ctx.projectSelectionRevision) {
      sendResult(false, 'JSON Verify 저장 요청이 올바르지 않습니다.');
      return;
    }

    try {
      resolveGrantedReviewProject(ctx, activeVerifyDir);
      applyVerifiedJsonWrite(activeVerifyDir, {
        fileName,
        targetPath,
        expectedContent,
        nextContent,
      });
      sendResult(true);
    } catch (error) {
      if (error instanceof AtomicFileWriteError && error.cause instanceof AtomicFilePreimageMismatchError) {
        sendResult(false, '요청 후 대상 파일이 변경되어 결과를 적용하지 않았습니다.');
      } else if (error instanceof SyntaxError) {
        sendResult(false, '저장할 JSON 결과가 올바르지 않습니다.');
      } else {
        sendResult(false, (error as Error).message || 'JSON Verify 원자적 저장에 실패했습니다.');
      }
    }
  })

  // ── 줄밀림 LLM 재번역 ──
  ipcMain.on('verifyLlmRepair', async (ev, request: LlmRepairRequest) => {
    const win = jsonVerifyWindow;
    if (!win || win.isDestroyed() || ev.sender !== win.webContents) return;
    const send = (ch: string, ...args: unknown[]) => {
      if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
    };

    const requestId = typeof request?.requestId === 'string' && request.requestId.length <= 128
      ? request.requestId
      : '';
    const items = Array.isArray(request?.items)
      ? request.items.filter((item): item is LlmRepairRequest['items'][number] => (
        !!item && typeof item.path === 'string' && typeof item.origText === 'string'
      ))
      : [];
    if (!requestId || items.length === 0) {
      send('verifyLlmRepairDone', { requestId, success: false, error: 'LLM 복구 요청이 올바르지 않습니다.' });
      return;
    }

    const settings = ctx.settings;
    const readinessError = getLlmReadinessError(settings);
    if (readinessError) {
      send('verifyLlmRepairDone', { requestId, success: false, error: readinessError });
      return;
    }

    try {
      const sourceLang = settings.llmSourceLang || settings.langu || 'ja';
      const targetLang = settings.llmTargetLang || 'ko';
      const translator = createTranslator(settings, sourceLang, targetLang);
      const results: { path: string; origText: string; newText: string }[] = [];
      let failedItems = 0;

      for (let i = 0; i < items.length; i++) {
        send('verifyLlmRepairProgress', { requestId, current: i + 1, total: items.length, path: items[i].path });
        try {
          const newText = await translator.translateText(items[i].origText);
          const validation = validateTranslatedFileContent(items[i].origText, newText);
          if (!validation.ok || newText === items[i].origText) {
            failedItems += 1;
            continue;
          }
          results.push({ path: items[i].path, origText: items[i].origText, newText });
        } catch {
          // Provider errors can contain request details or credentials. They
          // must not become replacement text or be reflected to the renderer.
          failedItems += 1;
        }
      }

      if (failedItems > 0) {
        send('verifyLlmRepairDone', {
          requestId,
          success: false,
          error: `${failedItems}/${items.length}개 항목의 재번역 또는 무결성 검증에 실패했습니다.`,
        });
        return;
      }
      send('verifyLlmRepairDone', { requestId, success: true, results });
    } catch {
      send('verifyLlmRepairDone', { requestId, success: false, error: 'LLM 재번역 처리에 실패했습니다.' });
    }
  })
}
