import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppContext } from '../appContext';
import log from '../logger';

interface UiHarnessScenario {
  compareDir: string;
  verifyDir: string;
  timeoutMs?: number;
}

interface UiHarnessResult {
  suite: string;
  status: 'passed' | 'failed';
  completedAt: string;
  snapshots?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeResult(resultPath: string, result: UiHarnessResult): void {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
}

function urlMatchesRoute(url: string, route: string): boolean {
  return url.includes(`#${route}`);
}

async function waitForWindow(route: string, timeoutMs: number): Promise<BrowserWindow> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const win = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      return urlMatchesRoute(candidate.webContents.getURL(), route);
    });
    if (win) return win;
    await delay(100);
  }
  throw new Error(`Timed out waiting for window ${route}`);
}

async function waitForWindowClose(route: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const existing = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      return urlMatchesRoute(candidate.webContents.getURL(), route);
    });
    if (!existing) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for window ${route} to close`);
}

async function waitForSelector(win: BrowserWindow, selector: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  const serializedSelector = JSON.stringify(selector);
  while (Date.now() - startedAt < timeoutMs) {
    const exists = await win.webContents.executeJavaScript(
      `Boolean(document.querySelector(${serializedSelector}))`,
      true,
    );
    if (exists) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for selector ${selector}`);
}

async function waitForAttributeValue(
  win: BrowserWindow,
  selector: string,
  attribute: string,
  expectedValue: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  const serializedSelector = JSON.stringify(selector);
  const serializedAttribute = JSON.stringify(attribute);
  const serializedExpected = JSON.stringify(expectedValue);

  while (Date.now() - startedAt < timeoutMs) {
    const matches = await win.webContents.executeJavaScript(
      `(() => {
        const node = document.querySelector(${serializedSelector});
        return node ? node.getAttribute(${serializedAttribute}) === ${serializedExpected} : false;
      })()`,
      true,
    );
    if (matches) return;
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${selector}[${attribute}=${expectedValue}]`);
}

async function snapshot(win: BrowserWindow, source: string): Promise<unknown> {
  return win.webContents.executeJavaScript(source, true);
}

function emit(channel: string, ...args: unknown[]): void {
  ipcMain.emit(channel, {} as Electron.IpcMainEvent, ...args);
}

async function openLlmSettingsSnapshot(ctx: AppContext, llmReady: boolean, targetDir: string, timeoutMs: number): Promise<unknown> {
  ctx.settings.llmProvider = 'gemini';
  ctx.settings.llmApiKey = llmReady ? 'harness-key' : '';
  ctx.settings.llmModel = llmReady ? 'gemini-harness' : '';

  emit('openLLMSettings', { dir: targetDir.replaceAll('\\', '/'), game: 'mvmz' });
  const win = await waitForWindow('/llm-settings', timeoutMs);
  await waitForSelector(win, '[data-harness-view="llm-settings"]', timeoutMs);
  await waitForAttributeValue(win, '[data-harness-view="llm-settings"]', 'data-llm-ready', llmReady ? 'true' : 'false', timeoutMs);

  const result = await snapshot(win, `(() => {
    const root = document.querySelector('[data-harness-view="llm-settings"]');
    const hint = document.querySelector('.config-hint');
    return {
      llmReady: root?.getAttribute('data-llm-ready'),
      provider: root?.getAttribute('data-provider'),
      heading: document.querySelector('h2')?.textContent?.trim(),
      hint: hint?.textContent?.trim(),
    };
  })()`);

  win.close();
  await waitForWindowClose('/llm-settings', timeoutMs);
  return result;
}

export async function maybeRunUiHarness(ctx: AppContext): Promise<void> {
  const scenarioPath = process.env.LLM_TSUKURU_UI_HARNESS_SCENARIO;
  if (!scenarioPath) return;

  const resultPath = process.env.LLM_TSUKURU_UI_HARNESS_RESULT
    || path.join(process.cwd(), 'artifacts', 'harness', 'harness-ui.json');
  const timeoutMs = Number(process.env.LLM_TSUKURU_UI_HARNESS_TIMEOUT_MS || 30000);

  try {
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) as UiHarnessScenario;
    const stepTimeoutMs = scenario.timeoutMs || timeoutMs;

    const mainWindow = await waitForWindow('/', stepTimeoutMs);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);

    const home = await snapshot(mainWindow, `(() => ({
      heading: document.querySelector('[data-harness-view="home"] h1')?.textContent?.trim(),
      subtitle: document.querySelector('[data-harness-view="home"] .subtitle')?.textContent?.trim(),
      route: location.hash,
    }))()`);

    const llmSettingsMissing = await openLlmSettingsSnapshot(ctx, false, scenario.compareDir, stepTimeoutMs);
    const llmSettingsReady = await openLlmSettingsSnapshot(ctx, true, scenario.compareDir, stepTimeoutMs);

    emit('openLLMCompare', scenario.compareDir);
    const compareWindow = await waitForWindow('/llm-compare', stepTimeoutMs);
    await waitForSelector(compareWindow, '[data-harness-view="llm-compare"]', stepTimeoutMs);
    await waitForAttributeValue(compareWindow, '[data-harness-view="llm-compare"]', 'data-file-count', '2', stepTimeoutMs);
    const compare = await snapshot(compareWindow, `(() => {
      const root = document.querySelector('[data-harness-view="llm-compare"]');
      return {
        fileCount: root?.getAttribute('data-file-count'),
        mismatchCount: root?.getAttribute('data-mismatch-count'),
        untranslatedCount: root?.getAttribute('data-untranslated-count'),
        loading: root?.getAttribute('data-loading'),
        summary: Array.from(document.querySelectorAll('.summary > span')).map((node) => node.textContent?.trim()),
      };
    })()`);

    emit('openJsonVerify', scenario.verifyDir);
    const verifyWindow = await waitForWindow('/json-verify', stepTimeoutMs);
    await waitForSelector(verifyWindow, '[data-harness-view="json-verify"]', stepTimeoutMs);
    await waitForAttributeValue(verifyWindow, '[data-harness-view="json-verify"]', 'data-file-count', '2', stepTimeoutMs);
    const verify = await snapshot(verifyWindow, `(() => {
      const root = document.querySelector('[data-harness-view="json-verify"]');
      return {
        fileCount: root?.getAttribute('data-file-count'),
        totalIssues: root?.getAttribute('data-total-issues'),
        errorFiles: root?.getAttribute('data-error-files'),
        warningFiles: root?.getAttribute('data-warning-files'),
        summary: Array.from(document.querySelectorAll('.summary > span')).map((node) => node.textContent?.trim()),
      };
    })()`);

    const result: UiHarnessResult = {
      suite: 'harness-ui',
      status: 'passed',
      completedAt: new Date().toISOString(),
      snapshots: {
        home,
        llmSettingsMissing,
        llmSettingsReady,
        compare,
        verify,
      },
    };

    writeResult(resultPath, result);
    setTimeout(() => app.exit(0), 100);
  } catch (error) {
    const result: UiHarnessResult = {
      suite: 'harness-ui',
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: {
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    };
    log.error('UI harness failed:', error);
    writeResult(resultPath, result);
    setTimeout(() => app.exit(1), 100);
  }
}
