import { app, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppContext } from '../appContext';
import log from '../logger';
import { exerciseJsonReview } from './jsonReviewHarness';

interface UiHarnessScenario {
  compareDir: string;
  verifyDir: string;
  timeoutMs?: number;
  expectedHomeHeading?: string;
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

export async function captureScreen(win: BrowserWindow, directory: string, name: string, timeoutMs = 3000): Promise<string> {
  const output = path.join(directory, `${name}.png`);
  // DOM assertions may finish before their changes reach the captured frame.
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UI did not paint before capture')), ${timeoutMs});
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve(null);
    }));
  })`, true);
  const startedAt = Date.now();
  // DOM readiness can precede the first compositor frame on a fresh window.
  do {
    const image = await win.webContents.capturePage();
    if (!image.isEmpty()) {
      fs.writeFileSync(output, image.toPNG());
      return output;
    }
    await delay(100);
  } while (Date.now() - startedAt < timeoutMs);
  throw new Error(`UI capture is empty after ${timeoutMs}ms: ${name}`);
}

async function captureFailure(directory: string, stage: string): Promise<void> {
  const windows = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const info: Record<string, unknown> = {
      id: win.id, visible: win.isVisible(), minimized: win.isMinimized(), bounds: win.getBounds(),
    };
    try {
      // Only structural state. Never dump form values, HTML, or bridge tokens.
      info.state = await snapshot(win, `({ route: location.hash, readyState: document.readyState,
        view: document.querySelector('[data-harness-view]')?.getAttribute('data-harness-view') ?? null })`);
      info.screenshot = await captureScreen(win, directory, `failure-window-${win.id}`);
    } catch { info.captureFailed = true; }
    windows.push(info);
  }
  fs.writeFileSync(path.join(directory, 'diagnostics.json'), JSON.stringify({ stage, windows }, null, 2));
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

async function click(win: BrowserWindow, selector: string): Promise<void> {
  await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error('UI action is missing or disabled: ' + ${JSON.stringify(selector)});
    }
    button.click();
  })()`, true);
}

async function selectProject(ctx: AppContext, dataDir: string, timeoutMs: number): Promise<void> {
  const win = ctx.mainWindow!;
  await win.webContents.executeJavaScript(`location.hash = '#/mvmz'`, true);
  await waitForSelector(win, '[data-harness-view="mvmz"] .project-header .btn-secondary', timeoutMs);
  // Stub only the native picker. The real button, preload, and selection handler
  // establish the trusted roots, runtime, and bridge.
  const showOpenDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dataDir] })) as typeof dialog.showOpenDialog;
  try {
    const projectPicker = await snapshot(win, `document.querySelector('[data-harness-workspace-shell] .change-project') ? '[data-harness-workspace-shell] .change-project' : '[data-harness-view="mvmz"] .project-header .btn-secondary'`);
    await click(win, String(projectPicker));
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const selectedPath = await snapshot(win, `document.querySelector('.project-path span')?.textContent`);
      if (selectedPath === dataDir) break;
      await delay(100);
    }
    const selectedPath = await snapshot(win, `document.querySelector('.project-path span')?.textContent`);
    if (selectedPath !== dataDir) throw new Error('Project selection did not reach the renderer.');
    await waitForAttributeValue(win, '[data-harness-view="mvmz"]', 'data-project-state', 'ready', timeoutMs);
  } finally {
    dialog.showOpenDialog = showOpenDialog;
  }
  if (ctx.currentTerminalProjectRoot !== path.dirname(dataDir) || !ctx.agentBridgeServer?.isReady()) {
    throw new Error('Project selection did not initialize the production approval bridge.');
  }
}

async function openLlmSettingsSnapshot(ctx: AppContext, llmReady: boolean, targetDir: string, timeoutMs: number, captureDir: string): Promise<unknown> {
  ctx.settings.llmProvider = 'gemini';
  ctx.settings.llmApiKey = llmReady ? 'harness-key' : '';
  ctx.settings.llmModel = llmReady ? 'gemini-harness' : '';
  ctx.settings.llmParallelWorkers = 4;
  ctx.settings.llmCustomPrompt = 'Harness custom prompt';

  await selectProject(ctx, targetDir, timeoutMs);
  await click(ctx.mainWindow!, '.pipeline > button:nth-child(2)');
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
      model: document.querySelector('.model-summary dd')?.textContent?.trim(),
      advancedCollapsed: !document.querySelector('.disclosure-panel')?.open,
      startDisabled: document.querySelector('.button-bar .primary')?.disabled,
    };
  })()`);

  // Allow the disabled-to-ready button transition to settle before visual evidence.
  await delay(200);
  await captureScreen(win, captureDir, llmReady ? 'translation-ready' : 'translation-missing');
  if (win === ctx.mainWindow) await click(win, '.button-bar .btn');
  else win.close();
  await waitForWindowClose('/llm-settings', timeoutMs);
  return result;
}

export async function maybeRunUiHarness(ctx: AppContext): Promise<void> {
  const scenarioPath = process.env.LLM_TSUKURU_UI_HARNESS_SCENARIO;
  if (!scenarioPath) return;

  const resultPath = process.env.LLM_TSUKURU_UI_HARNESS_RESULT
    || path.join(process.cwd(), 'artifacts', 'harness', 'harness-ui.json');
  const timeoutMs = Number(process.env.LLM_TSUKURU_UI_HARNESS_TIMEOUT_MS || 30000);
  const diagnosticDir = path.dirname(resultPath);
  let stage = 'scenario';
  const screenshots: Record<string, string> = {};
  const checkpoint = (name: string): void => {
    stage = name;
    fs.mkdirSync(diagnosticDir, { recursive: true });
    fs.writeFileSync(path.join(diagnosticDir, 'progress.json'), JSON.stringify({ stage, updatedAt: new Date().toISOString() }));
  };

  try {
    checkpoint('scenario');
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) as UiHarnessScenario;
    const stepTimeoutMs = scenario.timeoutMs || timeoutMs;
    const profile = path.resolve(process.env.LLM_TSUKURU_UI_HARNESS_USER_DATA!);
    if (app.getPath('userData') !== profile
      || app.getPath('sessionData') !== path.join(profile, 'session')
      || app.getPath('logs') !== path.join(profile, 'logs')) {
      throw new Error('UI harness is not using its isolated Electron profile.');
    }

    checkpoint('home-window');
    const mainWindow = await waitForWindow('/', stepTimeoutMs);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);

    const home = await snapshot(mainWindow, `(() => ({
      heading: document.querySelector('[data-harness-view="home"] h1')?.textContent?.trim(),
      subtitle: document.querySelector('[data-harness-view="home"] .subtitle')?.textContent?.trim(),
      route: location.hash,
    }))()`);
    assertSnapshotValues('home', home, {
      heading: scenario.expectedHomeHeading ?? '번역 프로젝트를 시작하세요',
      subtitle: '게임 엔진을 선택하면 추출부터 검수와 적용까지 한 흐름으로 이어집니다.',
      route: '#/',
    });
    screenshots.home = await captureScreen(mainWindow, diagnosticDir, 'home');

    checkpoint('mvmz-empty-state');
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

    checkpoint('wolf-empty-state');
    await mainWindow.webContents.executeJavaScript(`location.hash = '#/wolf'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="wolf"]', stepTimeoutMs);
    const wolfEmpty = await snapshot(mainWindow, `(() => {
      const root = document.querySelector('[data-harness-view="wolf"]');
      const primary = root?.querySelector('[data-harness-primary-action]');
      return {
        projectState: root?.getAttribute('data-project-state'),
        currentTask: root?.querySelector('[data-harness-current-task]')?.textContent?.trim(),
        primaryAction: primary?.textContent?.trim(),
        primaryDisabled: primary instanceof HTMLButtonElement ? primary.disabled : null,
        lockedPipelineActions: root?.querySelectorAll('.wolf-pipeline button:disabled').length ?? 0,
      };
    })()`);
    assertSnapshotValues('wolf-empty', wolfEmpty, {
      projectState: 'empty',
      currentTask: '프로젝트 폴더 선택',
      primaryAction: '폴더 선택하기',
      primaryDisabled: false,
      lockedPipelineActions: 3,
    });

    await mainWindow.webContents.executeJavaScript(`location.hash = '#/'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);

    checkpoint('project-selection-and-approval');
    await selectProject(ctx, scenario.compareDir, stepTimeoutMs);
    await click(mainWindow, '[data-harness-project-snapshot] button');
    const projectFiles = await snapshot(mainWindow, `document.querySelector('[data-harness-project-snapshot] [role="status"]')?.textContent`);
    if (!String(projectFiles).includes('2개 파일')) throw new Error('Project snapshot must report the real extracted fixture count.');
    screenshots.project = await captureScreen(mainWindow, diagnosticDir, 'project');
    const bridgeManifest = JSON.parse(fs.readFileSync(ctx.agentBridgeServer!.manifestPath, 'utf8')) as { token: string };
    await mainWindow.webContents.executeJavaScript(`location.hash = '#/'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);
    await waitForSelector(mainWindow, '[data-harness-resume-project]', stepTimeoutMs);
    screenshots.resume = await captureScreen(mainWindow, diagnosticDir, 'resume');
    await click(mainWindow, '[data-harness-resume-project]');
    await waitForSelector(mainWindow, '[data-harness-view="mvmz"]', stepTimeoutMs);
    const restoredProjectPath = await snapshot(mainWindow, `document.querySelector('.project-path span')?.textContent`);
    if (restoredProjectPath !== scenario.compareDir) throw new Error('Returning from home lost the selected project.');
    mainWindow.webContents.send('llmTranslating', true);
    mainWindow.webContents.send('loading', 25);
    await mainWindow.webContents.executeJavaScript(`location.hash = '#/'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);
    await click(mainWindow, '[data-harness-resume-project]');
    await waitForSelector(mainWindow, '[data-harness-workspace-shell]', stepTimeoutMs);
    const persistentAbort = await snapshot(mainWindow, `Array.from(document.querySelectorAll('.abort-btn')).some(button => button.getBoundingClientRect().width > 0)`);
    if (!persistentAbort) throw new Error('Home navigation lost the running job abort control.');
    mainWindow.webContents.send('llmTranslating', false);
    mainWindow.webContents.send('loading', 0);
    await mainWindow.webContents.executeJavaScript(`location.hash = '#/'`, true);
    await waitForSelector(mainWindow, '[data-harness-view="home"]', stepTimeoutMs);
    const approvalTargetPath = path.join(path.dirname(scenario.compareDir), 'Harness', 'Approval.txt');
    const approvalOriginalBytes = Buffer.from('--- 101 ---\r\nHello \\V[1]\r\n', 'utf-8');
    const approvalExpectedBytes = Buffer.from('--- 101 ---\r\n안녕하세요 \\V[1]\r\n', 'utf-8');
    fs.mkdirSync(path.dirname(approvalTargetPath), { recursive: true });
    fs.writeFileSync(approvalTargetPath, approvalOriginalBytes);
    const approvalRequest = {
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
    };
    const submitted = await mainWindow.webContents.executeJavaScript(
      `window.api.approvals.submit(${JSON.stringify(approvalRequest)})`, true,
    );
    if (!submitted?.ok || !submitted.approval?.approvalId) {
      throw new Error(`Renderer approval submission failed: ${JSON.stringify(submitted)}`);
    }
    const approval = submitted.approval as { approvalId: string };

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
    checkpoint('agent-workspace');
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

    checkpoint('llm-settings-missing');
    const llmSettingsMissing = await openLlmSettingsSnapshot(ctx, false, scenario.compareDir, stepTimeoutMs, diagnosticDir);
    assertSnapshotValues('llmSettingsMissing', llmSettingsMissing, {
      llmReady: 'false',
      provider: 'gemini',
      parallelWorkers: '4',
      guidelinePanelPresent: true,
      generateGuidelineDisabled: true,
      applyGuidelineDisabled: true,
    });
    checkpoint('llm-settings-ready');
    const llmSettingsReady = await openLlmSettingsSnapshot(ctx, true, scenario.compareDir, stepTimeoutMs, diagnosticDir);
    screenshots.translation = path.join(diagnosticDir, 'translation-ready.png');
    assertSnapshotValues('llmSettingsReady', llmSettingsReady, {
      model: 'gemini-harness',
      advancedCollapsed: true,
      startDisabled: false,
      llmReady: 'true',
      provider: 'gemini',
      parallelWorkers: '4',
      guidelinePanelPresent: true,
      generateGuidelineDisabled: true,
      applyGuidelineDisabled: true,
    });

    checkpoint('compare-window');
    // One isolated fixture project has both text and JSON representations so
    // the production workspace can exercise cross-tool file context.
    fs.mkdirSync(path.join(scenario.compareDir, 'Backup'), { recursive: true });
    for (const name of ['Map001.json', 'Map002.json']) {
      fs.copyFileSync(path.join(scenario.verifyDir, name), path.join(scenario.compareDir, name));
      fs.copyFileSync(path.join(scenario.verifyDir, 'Backup', name), path.join(scenario.compareDir, 'Backup', name));
    }
    await selectProject(ctx, scenario.compareDir, stepTimeoutMs);
    await click(mainWindow, '.pipeline > button:nth-child(3)');
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
    screenshots.compare = await captureScreen(compareWindow, diagnosticDir, 'compare');

    checkpoint('workspace-review-tabs');
    if (compareWindow !== mainWindow) throw new Error('Review must be inside the main workspace.');
    await compareWindow.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('.block-editor');
      editor.value = '검수 초안\\n';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.select-indicator input').click();
    })()`, true);
    await click(mainWindow, '[data-workspace-review="structure"]');
    await waitForSelector(mainWindow, '[data-harness-view="json-verify"]', stepTimeoutMs);
    await waitForAttributeValue(mainWindow, '[data-harness-view="json-verify"]', 'data-file-count', '2', stepTimeoutMs);
    const sameFile = await snapshot(mainWindow, `document.querySelector('.issues-file-name')?.textContent?.trim()`);
    if (sameFile !== 'Map001.json') throw new Error('Review tabs did not preserve the selected file context.');
    screenshots.unifiedStructure = await captureScreen(mainWindow, diagnosticDir, 'workspace-structure');
    await click(mainWindow, '[data-workspace-review="text"]');
    await waitForSelector(mainWindow, '[data-harness-view="llm-compare"]', stepTimeoutMs);
    const preservedDraft = await snapshot(mainWindow, `({
      value: document.querySelector('.block-editor')?.value,
      selected: document.querySelector('.select-indicator input')?.checked,
      saveEnabled: !document.querySelector('.toolbar .primary-action')?.disabled,
      dirtyBadge: document.querySelector('[data-workspace-tab="review"]')?.textContent.includes('미저장'),
      summaryLoaded: !document.querySelector('[data-workspace-review="text"]')?.textContent.includes('미확인'),
      focusedFile: document.querySelector('.focused-file')?.textContent,
      terminalInStatus: document.querySelector('.agent-chip')?.getBoundingClientRect().top >= document.querySelector('.workspace-status')?.getBoundingClientRect().top,
    })`);
    assertSnapshotValues('reviewDraft', preservedDraft, {
      value: '검수 초안\n', selected: true, saveEnabled: true,
      dirtyBadge: true, summaryLoaded: true, focusedFile: 'Map001.txt', terminalInStatus: true,
    });
    screenshots.unifiedReview = await captureScreen(mainWindow, diagnosticDir, 'workspace-review');
    await click(mainWindow, '.toolbar .primary-action');

    checkpoint('workspace-settings-draft');
    await click(mainWindow, '[data-workspace-tab="settings"]');
    await waitForSelector(mainWindow, '#llmModel', stepTimeoutMs);
    await mainWindow.webContents.executeJavaScript(`(() => {
      const model = document.querySelector('#llmModel');
      model.value = 'workspace-unsaved-model';
      model.dispatchEvent(new Event('input', { bubbles: true }));
    })()`, true);
    await click(mainWindow, '[data-workspace-tab="review"]');
    await waitForSelector(mainWindow, '[data-harness-view="llm-compare"]', stepTimeoutMs);
    await click(mainWindow, '[data-workspace-tab="settings"]');
    await waitForSelector(mainWindow, '#llmModel', stepTimeoutMs);
    const preservedModel = await snapshot(mainWindow, `document.querySelector('#llmModel')?.value`);
    if (preservedModel !== 'workspace-unsaved-model') throw new Error('Tab switch overwrote unsaved settings.');
    screenshots.settings = await captureScreen(mainWindow, diagnosticDir, 'workspace-settings');
    await click(mainWindow, '.button-bar .btn');
    await waitForSelector(mainWindow, '[data-harness-view="llm-compare"]', stepTimeoutMs);
    if (BrowserWindow.getAllWindows().length !== 1) throw new Error('Tool navigation opened an extra window.');

    checkpoint('json-verify-window');
    await selectProject(ctx, scenario.verifyDir, stepTimeoutMs);
    await click(mainWindow, '.review-link');
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
    screenshots.verify = await captureScreen(verifyWindow, diagnosticDir, 'verify');

    checkpoint('json-verify-actions');
    const jsonReviewCases = await exerciseJsonReview(verifyWindow, scenario.verifyDir, stepTimeoutMs);

    const result: UiHarnessResult = {
      schemaVersion: 1,
      suite: 'harness-ui',
      status: 'passed',
      completedAt: new Date().toISOString(),
      cases: [
        ...jsonReviewCases,
        { id: 'unified-workspace', title: 'Single window review context and unsaved text/settings survive tab switches', status: 'passed', durationMs: 0, details: { sameFile, preservedDraft, preservedModel, windowCount: 1 } },
        { id: 'project-session', title: 'Project file count and home return preserve actual session context', status: 'passed', durationMs: 0, details: { projectFiles, restoredProjectPath } },
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
        caseCount: 12 + jsonReviewCases.length,
        deterministic: true,
      },
      artifacts: {
        scenario: scenarioPath,
        screenshots,
        progress: path.join(diagnosticDir, 'progress.json'),
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

    checkpoint('cleanup');
    await cleanupHarness(ctx);
    checkpoint('completed');
    writeResult(resultPath, result);
    app.exit(0);
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
        screenshots,
        progress: path.join(diagnosticDir, 'progress.json'),
        diagnostics: path.join(diagnosticDir, 'diagnostics.json'),
      },
      reproCommand: 'npm run harness:ui',
      failureHints: [
        `Inspect the UI harness scenario at ${scenarioPath}`,
        'Rerun npm run harness:ui after fixing the failing window or selector.',
      ],
      error: {
        message: `[${stage}] ${(error as Error).message}`,
        stack: (error as Error).stack,
      },
    };
    log.error('UI harness failed:', error);
    try {
      await captureFailure(diagnosticDir, stage);
    } catch { result.failureHints?.push('Failure diagnostics could not be captured; inspect the Electron log.'); }
    try {
      await cleanupHarness(ctx);
    } catch (cleanupError) {
      result.failureHints?.push(`Cleanup failed: ${(cleanupError as Error).message}`);
    }
    try {
      writeResult(resultPath, result);
    } finally {
      app.exit(1);
    }
  }
}

async function cleanupHarness(ctx: AppContext): Promise<void> {
  const bridge = ctx.agentBridgeServer;
  try {
    await bridge?.stop();
  } finally {
    ctx.agentBridgeServer = null;
    try {
      ctx.mutationApprovalRuntime?.dispose('ui-harness-finished');
    } finally {
      ctx.mutationApprovalRuntime = null;
      ctx.terminalService?.disposeAll('ui-harness-finished');
    }
  }
  if (bridge && fs.existsSync(bridge.manifestPath)) {
    throw new Error('UI harness bridge manifest remained after shutdown.');
  }
}
