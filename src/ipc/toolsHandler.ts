import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import open from 'open';
import * as prjc from '../ts/rpgmv/projectConvert';
import { buildVerifyWindowState } from '../ts/libs/llmProviderConfig';
import { createTranslator, getLlmReadinessError } from '../ts/libs/translatorFactory';
import { validateTranslatedFileContent } from '../ts/rpgmv/translator';
import { loadRoute } from './viteHelper';
import { AppContext } from '../appContext';
import { PROJECT_ROOT } from '../projectRoot';
import { AtomicFilePreimageMismatchError, AtomicFileWriteError } from '../ts/libs/atomicFile';
import { applyVerifiedJsonWrite } from '../ts/rpgmv/verifyWrite';

let llmCompareWindow: Electron.BrowserWindow | null = null;

export function getLLMCompareWindow(): Electron.BrowserWindow | null {
  return llmCompareWindow;
}

export function registerToolsHandlers(ctx: AppContext) {
  let jsonVerifyWindow: Electron.BrowserWindow | null = null;
  let pendingCompareDir: string | null = null;
  let pendingVerifyDir: string | null = null;
  let activeVerifyDir: string | null = null;

  ipcMain.on('openLLMCompare', (ev, dir: string) => {
    if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
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
    loadRoute(llmCompareWindow, '/llm-compare');
    llmCompareWindow.webContents.on('did-finish-load', () => {
      llmCompareWindow!.show();
    });
    llmCompareWindow.on('closed', () => {
      llmCompareWindow = null;
    });
  })

  ipcMain.on('llmCompareClose', () => {
    if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
      llmCompareWindow.close();
    }
  })

  ipcMain.on('compareReady', () => {
    if (pendingCompareDir && llmCompareWindow && !llmCompareWindow.isDestroyed()) {
      llmCompareWindow.webContents.send('replace-allowed-paths', [pendingCompareDir]);
      llmCompareWindow.webContents.send('initCompare', pendingCompareDir);
      pendingCompareDir = null;
    }
  })

  ipcMain.on('openJsonVerify', (ev, dir: string) => {
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

  ipcMain.on('verifyReady', () => {
    if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
      jsonVerifyWindow.webContents.send('verifySettings', buildVerifyWindowState(ctx.settings));
      if (pendingVerifyDir) {
        jsonVerifyWindow.webContents.send('replace-allowed-paths', [pendingVerifyDir]);
        jsonVerifyWindow.webContents.send('initVerify', pendingVerifyDir);
        pendingVerifyDir = null;
      }
    }
  })

  ipcMain.on('openFolder', (ev, arg) => {
    open(arg)
  })

  ipcMain.on('projectConvert', async(ev, arg) => prjc.ConvertProject(arg, ctx))

  interface VerifyApplyJsonRequest {
    requestId: string;
    fileName: string;
    targetPath: string;
    expectedContent: string;
    nextContent: string;
  }

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
      || !activeVerifyDir) {
      sendResult(false, 'JSON Verify 저장 요청이 올바르지 않습니다.');
      return;
    }

    try {
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
  interface LlmRepairItem {
    path: string;
    origText: string;
  }

  interface LlmRepairRequest {
    requestId: string;
    items: LlmRepairItem[];
  }

  ipcMain.on('verifyLlmRepair', async (_ev, request: LlmRepairRequest) => {
    const win = jsonVerifyWindow;
    if (!win || win.isDestroyed()) return;
    const send = (ch: string, ...args: unknown[]) => {
      if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
    };

    const requestId = typeof request?.requestId === 'string' && request.requestId.length <= 128
      ? request.requestId
      : '';
    const items = Array.isArray(request?.items)
      ? request.items.filter((item): item is LlmRepairItem => (
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
          const translated = await translator.translateText(items[i].origText);
          const newText = translated.trim();
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
