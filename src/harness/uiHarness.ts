import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppContext } from '../appContext';
import { AgentBridgeServer } from '../agent/agentBridgeServer';
import { MutationApprovalRuntime } from '../agent/mutationApprovalRuntime';
import log from '../logger';

interface UiHarnessScenario {
  compareDir: string;
  verifyDir: string;
  timeoutMs?: number;
}

interface UiHarnessResult {
  schemaVersion?: number;
  suite: string;
  status: 'passed' | 'failed';
  completedAt: string;
  cases?: Array<{
    id: string;
    title: string;
    status: 'passed' | 'failed';
    durationMs: number;
    details?: unknown;
    error?: {
      message: string;
      stack?: string;
    };
  }>;
  metrics?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  reproCommand?: string;
  failureHints?: string[];
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

function assertSnapshotValues(
  label: string,
  value: unknown,
  expected: Record<string, string | number | boolean>,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} snapshot is not an object`);
  }

  const actual = value as Record<string, unknown>;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      throw new Error(`${label}.${key} expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actual[key])}`);
    }
  }
}

function emit(channel: string, ...args: unknown[]): void {
  ipcMain.emit(channel, {} as Electron.IpcMainEvent, ...args);
}

async function openLlmSettingsSnapshot(ctx: AppContext, llmReady: boolean, targetDir: string, timeoutMs: number): Promise<unknown> {
  ctx.settings.llmProvider = 'gemini';
  ctx.settings.llmApiKey = llmReady ? 'harness-key' : '';
  ctx.settings.llmModel = llmReady ? 'gemini-harness' : '';
  ctx.settings.llmParallelWorkers = 4;
  ctx.settings.llmCustomPrompt = 'Harness custom prompt';

  emit('openLLMSettings', { dir: targetDir.replaceAll('\\', '/'), game: 'mvmz' });
  const win = await waitForWindow('/llm-settings', timeoutMs);
  await waitForSelector(win, '[data-harness-view="llm-settings"]', timeoutMs);
  await waitForAttributeValue(win, '[data-harness-view="llm-settings"]', 'data-llm-ready', llmReady ? 'true' : 'false', timeoutMs);
  await waitForSelector(win, '[data-harness-guideline-panel]', timeoutMs);
  await waitForSelector(win, '[data-harness-guideline-draft]', timeoutMs);

  const result = await snapshot(win, `(() => {
    const root = document.querySelector('[data-harness-view="llm-settings"]');
    const hint = document.querySelector('.config-hint');
    const parallelWorkers = document.querySelector('#parallelWorkers');
    const generateButton = Array.from(document.querySelectorAll('.guideline-actions button'))[1];
    const applyButton = document.querySelector('.merge-row button');
    return {
      llmReady: root?.getAttribute('data-llm-ready'),
      provider: root?.getAttribute('data-provider'),
      parallelWorkers: parallelWorkers?.value,
      heading: document.querySelector('h2')?.textContent?.trim(),
      hint: hint?.textContent?.trim(),
      guidelinePanelPresent: Boolean(document.querySelector('[data-harness-guideline-panel]')),
      guidelineDraftPlaceholder: document.querySelector('[data-harness-guideline-draft]')?.getAttribute('placeholder'),
      generateGuidelineDisabled: Boolean(generateButton?.disabled),
      applyGuidelineDisabled: Boolean(applyButton?.disabled),
      promptNote: document.querySelector('.prompt-note')?.textContent?.trim(),
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
    assertSnapshotValues('home', home, {
      heading: '번역 프로젝트를 시작하세요',
      subtitle: '게임 엔진을 선택하면 추출부터 검수와 적용까지 한 흐름으로 이어집니다.',
      route: '#/',
    });

    await mainWindow.webContents.executeJavaScript(`location.hash = '#/mvmz'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="mvmz"]', stepTimeoutMs);
    const mvmzEmpty = await snapshot(mainWindow, `(() => {
      const root = document.querySelector('[data-harness-view="mvmz"]');
      const option = root?.querySelector('.option-btn');
      const primary = root?.querySelector('[data-harness-primary-action]');
      return {
        projectState: root?.getAttribute('data-project-state'),
        currentTask: root?.querySelector('[data-harness-current-task]')?.textContent?.trim(),
        primaryAction: primary?.textContent?.trim(),
        primaryDisabled: primary instanceof HTMLButtonElement ? primary.disabled : null,
        optionDisabled: option instanceof HTMLButtonElement ? option.disabled : null,
      };
    })()`);
    assertSnapshotValues('mvmz-empty', mvmzEmpty, {
      projectState: 'empty',
      currentTask: '프로젝트 폴더 선택',
      primaryAction: '폴더 선택하기',
      primaryDisabled: false,
      optionDisabled: true,
    });

    await mainWindow.webContents.executeJavaScript(`location.hash = '#/wolf'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="wolf"]', stepTimeoutMs);
    const wolfEmpty = await snapshot(mainWindow, `(() => {
      const root = document.querySelector('[data-harness-view="wolf"]');
      const option = root?.querySelector('.option-btn');
      const primary = root?.querySelector('[data-harness-primary-action]');
      return {
        projectState: root?.getAttribute('data-project-state'),
        currentTask: root?.querySelector('[data-harness-current-task]')?.textContent?.trim(),
        primaryAction: primary?.textContent?.trim(),
        primaryDisabled: primary instanceof HTMLButtonElement ? primary.disabled : null,
        optionDisabled: option instanceof HTMLButtonElement ? option.disabled : null,
      };
    })()`);
    assertSnapshotValues('wolf-empty', wolfEmpty, {
      projectState: 'empty',
      currentTask: '프로젝트 폴더 선택',
      primaryAction: '폴더 선택하기',
      primaryDisabled: false,
      optionDisabled: true,
    });

    await mainWindow.webContents.executeJavaScript(`location.hash = '#/'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);

    ctx.terminalProjectRoots = [scenario.compareDir];
    ctx.currentTerminalProjectRoot = scenario.compareDir;
    const approvalTargetPath = path.join(scenario.compareDir, 'Harness', 'Approval.txt');
    const approvalOriginalBytes = Buffer.from('--- 101 ---\r\nHello \\V[1]\r\n', 'utf-8');
    const approvalExpectedBytes = Buffer.from('--- 101 ---\r\n안녕하세요 \\V[1]\r\n', 'utf-8');
    fs.mkdirSync(path.dirname(approvalTargetPath), { recursive: true });
    fs.writeFileSync(approvalTargetPath, approvalOriginalBytes);
    ctx.mutationApprovalRuntime = new MutationApprovalRuntime({
      projectRoot: scenario.compareDir,
      appSessionId: ctx.agentAppSessionId,
      onChanged: (queueSnapshot) => {
        if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
          ctx.mainWindow.webContents.send('approvalQueueChanged', queueSnapshot);
        }
      },
    });
    ctx.agentBridgeServer = new AgentBridgeServer({
      runtime: ctx.mutationApprovalRuntime,
      userDataPath: app.getPath('userData'),
    });
    const bridgeManifest = await ctx.agentBridgeServer.start();
    const approval = ctx.mutationApprovalRuntime.submit({
      schemaVersion: 1,
      requestId: 'ui-harness-approval',
      idempotencyKey: 'ui-harness-approval-v1',
      toolName: 'patch.apply',
      patch: {
        schemaVersion: 1,
        patchId: 'ui-harness-patch',
        createdAt: new Date().toISOString(),
        dryRunOnly: true,
        targetPath: 'Harness/Approval.txt',
        operations: [{
          opId: 'replace-greeting',
          kind: 'replace-line',
          targetPath: 'Harness/Approval.txt',
          lineNumber: 2,
          originalText: 'Hello \\V[1]',
          replacementText: '안녕하세요 \\V[1]',
        }],
        invariantPolicy: {
          preserveLineCount: true,
          requiresAlignmentProofForLineCountChange: true,
        },
      },
    }, 'renderer');

    await waitForSelector(mainWindow, '[data-harness-approval-banner]', stepTimeoutMs);
    await waitForAttributeValue(
      mainWindow,
      '[data-harness-approval-banner]',
      'data-pending-count',
      '1',
      stepTimeoutMs,
    );
    const approvalBanner = await snapshot(mainWindow, `(() => ({
      pendingCount: document.querySelector('[data-harness-approval-banner]')?.getAttribute('data-pending-count'),
      accessibleFromHome: Boolean(document.querySelector('[data-harness-approval-banner]')),
    }))()`);
    assertSnapshotValues('approvalBanner', approvalBanner, {
      pendingCount: '1',
      accessibleFromHome: true,
    });

    await mainWindow.webContents.executeJavaScript(
      `document.querySelector('[data-harness-approval-banner]')?.click()`,
      true,
    );
    const agentWorkspaceWindow = await waitForWindow('/agent-workspace', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-view="agent-workspace"]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-agent-env-status]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-agent-mcp-connect]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-agent-cli-presets]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-agent-terminal-surface]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-approval-queue]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-approval-request]', stepTimeoutMs);
    await waitForSelector(agentWorkspaceWindow, '[data-harness-approval-preview-operation]', stepTimeoutMs);
    await agentWorkspaceWindow.webContents.executeJavaScript(
      `document.querySelector('[data-harness-agent-mcp-connect] button')?.click()`,
      true,
    );
    await waitForSelector(agentWorkspaceWindow, '[data-harness-mcp-command="codex"]', stepTimeoutMs);
    const agentWorkspace = await snapshot(agentWorkspaceWindow, `(() => ({
      route: location.hash,
      heading: document.querySelector('[data-harness-view="agent-workspace"] h1')?.textContent?.trim(),
      environmentItems: document.querySelectorAll('[data-harness-agent-env-status] li').length,
      cliPresetCount: document.querySelectorAll('[data-harness-agent-cli-presets] button').length,
      mcpConnectPresent: Boolean(document.querySelector('[data-harness-agent-mcp-connect]')),
      terminalSurfacePresent: Boolean(document.querySelector('[data-harness-agent-terminal-surface]')),
      approvalPendingCount: document.querySelector('[data-harness-approval-pending-count]')?.textContent?.trim(),
      approvalStatus: document.querySelector('[data-harness-approval-request]')?.getAttribute('data-approval-status'),
      approvalPreviewRows: document.querySelectorAll('[data-harness-approval-preview-operation]').length,
      approvalApprovePresent: Boolean(document.querySelector('[data-harness-approval-approve]')),
      approvalDenyPresent: Boolean(document.querySelector('[data-harness-approval-deny]')),
      focusedApprovalId: document.activeElement?.getAttribute('data-approval-id'),
      focusedDetailsOpen: Boolean(document.activeElement?.querySelector('details')?.open),
      summaryKeyboardReachable: document.querySelector('[data-harness-approval-request] summary')?.tabIndex === 0,
      mcpCommandCount: document.querySelectorAll('[data-harness-mcp-command]').length,
      mcpUsesBridgeManifest: Array.from(document.querySelectorAll('[data-harness-mcp-command]')).every(
        (node) => node.textContent?.includes('--bridge-manifest'),
      ),
      mcpExposesBearer: Array.from(document.querySelectorAll('[data-harness-mcp-command]')).some(
        (node) => node.textContent?.includes(${JSON.stringify(bridgeManifest.token)}),
      ),
    }))()`);
    assertSnapshotValues('agentWorkspace', agentWorkspace, {
      route: `#/agent-workspace?approval=${approval.approvalId}`,
      heading: 'AI 작업공간',
      environmentItems: 4,
      cliPresetCount: 3,
      mcpConnectPresent: true,
      terminalSurfacePresent: true,
      approvalPendingCount: '1',
      approvalStatus: 'pending',
      approvalPreviewRows: 1,
      approvalApprovePresent: true,
      approvalDenyPresent: true,
      focusedApprovalId: approval.approvalId,
      focusedDetailsOpen: true,
      summaryKeyboardReachable: true,
      mcpCommandCount: 2,
      mcpUsesBridgeManifest: true,
      mcpExposesBearer: false,
    });

    await agentWorkspaceWindow.webContents.executeJavaScript(
      `document.querySelector('[data-harness-approval-approve]')?.click()`,
      true,
    );
    await waitForAttributeValue(
      agentWorkspaceWindow,
      '[data-harness-approval-request]',
      'data-approval-status',
      'applied',
      stepTimeoutMs,
    );
    const approvalApplied = await snapshot(agentWorkspaceWindow, `(() => ({
      approvalPendingCount: document.querySelector('[data-harness-approval-pending-count]')?.textContent?.trim(),
      approvalStatus: document.querySelector('[data-harness-approval-request]')?.getAttribute('data-approval-status'),
      resultText: document.querySelector('[data-harness-approval-request] .request-result.success')?.textContent?.trim(),
      approvalApprovePresent: Boolean(document.querySelector('[data-harness-approval-approve]')),
      approvalDenyPresent: Boolean(document.querySelector('[data-harness-approval-deny]')),
    }))()`);
    assertSnapshotValues('approvalApplied', approvalApplied, {
      approvalPendingCount: '0',
      approvalStatus: 'applied',
      approvalApprovePresent: false,
      approvalDenyPresent: false,
    });
    if (!fs.readFileSync(approvalTargetPath).equals(approvalExpectedBytes)) {
      throw new Error('UI approval did not apply the exact expected bytes');
    }

    const llmSettingsMissing = await openLlmSettingsSnapshot(ctx, false, scenario.compareDir, stepTimeoutMs);
    const llmSettingsReady = await openLlmSettingsSnapshot(ctx, true, scenario.compareDir, stepTimeoutMs);
    assertSnapshotValues('llmSettingsMissing', llmSettingsMissing, {
      llmReady: 'false',
      provider: 'gemini',
      parallelWorkers: '4',
      guidelinePanelPresent: true,
      generateGuidelineDisabled: true,
      applyGuidelineDisabled: true,
    });
    assertSnapshotValues('llmSettingsReady', llmSettingsReady, {
      llmReady: 'true',
      provider: 'gemini',
      parallelWorkers: '4',
      guidelinePanelPresent: true,
      generateGuidelineDisabled: true,
      applyGuidelineDisabled: true,
    });

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
    assertSnapshotValues('compare', compare, {
      fileCount: '2',
      mismatchCount: '1',
      untranslatedCount: '1',
      loading: 'false',
    });

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
    assertSnapshotValues('verify', verify, {
      fileCount: '2',
      totalIssues: '1',
      errorFiles: '1',
      warningFiles: '0',
    });

    const result: UiHarnessResult = {
      schemaVersion: 1,
      suite: 'harness-ui',
      status: 'passed',
      completedAt: new Date().toISOString(),
      cases: [
        { id: 'home-window', title: 'home window exposes stable harness state', status: 'passed', durationMs: 0, details: home },
        { id: 'mvmz-empty-state', title: 'MV/MZ empty state leads with project selection', status: 'passed', durationMs: 0, details: mvmzEmpty },
        { id: 'wolf-empty-state', title: 'Wolf empty state leads with project selection', status: 'passed', durationMs: 0, details: wolfEmpty },
        { id: 'approval-banner', title: 'pending approval is visible and reachable outside Agent Workspace', status: 'passed', durationMs: 0, details: approvalBanner },
        { id: 'agent-workspace', title: 'agent workspace exposes stable environment, MCP, preset, and terminal state', status: 'passed', durationMs: 0, details: agentWorkspace },
        { id: 'approval-apply', title: 'approved UI patch is applied with exact preserved bytes', status: 'passed', durationMs: 0, details: approvalApplied },
        { id: 'llm-settings-missing', title: 'LLM settings reports missing provider readiness', status: 'passed', durationMs: 0, details: llmSettingsMissing },
        { id: 'llm-settings-ready', title: 'LLM settings reports ready provider state', status: 'passed', durationMs: 0, details: llmSettingsReady },
        { id: 'compare-window', title: 'compare window summarizes fixture mismatches', status: 'passed', durationMs: 0, details: compare },
        { id: 'json-verify-window', title: 'JSON verify window summarizes fixture issues', status: 'passed', durationMs: 0, details: verify },
      ],
      metrics: {
        caseCount: 10,
        deterministic: true,
      },
      artifacts: {
        scenario: scenarioPath,
      },
      reproCommand: 'npm run harness:ui',
      snapshots: {
        home,
        mvmzEmpty,
        wolfEmpty,
        approvalBanner,
        agentWorkspace,
        approvalApplied,
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
      schemaVersion: 1,
      suite: 'harness-ui',
      status: 'failed',
      completedAt: new Date().toISOString(),
      cases: [],
      metrics: {
        deterministic: true,
      },
      artifacts: {
        scenario: scenarioPath,
      },
      reproCommand: 'npm run harness:ui',
      failureHints: [
        `Inspect the UI harness scenario at ${scenarioPath}`,
        'Rerun npm run harness:ui after fixing the failing window or selector.',
      ],
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
