#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isolatedEnvironment, electronExecutable, childCompletion, shutdownChild, removePrivateState, withTimeout } = require('../local-runtime.cjs');

const {
  buildAppIfNeeded,
  copyDir,
  makeTempDir,
  projectRoot,
  readJson,
  relativeArtifactPath,
  writeFatalHarnessResult,
  writeHarnessResult,
  writeJson,
} = require('./_shared.cjs');

async function runElectronHarness(env, timeoutMs, executablePath, logPath) {
  const log = fs.openSync(logPath, 'w');
  let child;
  let completion;
  try {
    child = spawn(executablePath || electronExecutable(projectRoot), executablePath ? [] : ['.'], {
      cwd: projectRoot,
      stdio: ['ignore', log, log],
      env, windowsHide: true, shell: false,
    });
    completion = childCompletion(child);
    const result = await withTimeout(completion, timeoutMs, `UI harness timed out after ${timeoutMs}ms. Inspect ${logPath}`);
    if (result.error) throw result.error;
    return result.code ?? 1;
  } finally {
    try {
      await shutdownChild(child, completion, env.LLM_TSUKURU_UI_HARNESS_USER_DATA);
    } catch (error) {
      error.processMayBeRunning = true;
      throw error;
    } finally { fs.closeSync(log); }
  }
}

function assertUiEvidence(result, failureInjected = false) {
  if (result?.schemaVersion !== 1 || result.suite !== 'harness-ui'
    || !['passed', 'failed'].includes(result.status) || !Array.isArray(result.cases)
    || (result.status === 'passed' && (result.fatal || result.cases.length === 0 || result.cases.some(item => item?.status !== 'passed')))) {
    throw new Error('Electron did not provide valid nonempty UI success evidence.');
  }
  if (failureInjected && result.status === 'passed') {
    throw new Error('The requested home assertion fault was not exercised. The executable may not support this scenario.');
  }
}

async function main() {
  const workspace = makeTempDir('llm-tsukuru-ui-');
  const fixturesRoot = path.join(projectRoot, 'test', 'fixtures', 'harness', 'ui');
  const compareDir = path.join(workspace, 'compare-project', 'data');
  const verifyDir = path.join(workspace, 'verify-project', 'data');
  const resultPath = path.join(workspace, 'harness-ui-result.json');
  const scenarioPath = path.join(workspace, 'harness-ui-scenario.json');
  const storeDir = path.join(workspace, 'store');
  const userDataDir = path.join(workspace, 'user-data');
  const logPath = path.join(workspace, 'electron.log');
  const buildLog = path.join(workspace, 'build.log');
  const timeoutMs = 45000;
  const failureIndex = process.argv.indexOf('--fail-at');
  let result;
  let phase = 'arguments';
  try {
    if (failureIndex !== -1 && process.argv[failureIndex + 1] !== 'home') {
      throw new Error('The supported fault probe is --fail-at home. It must exit nonzero.');
    }
    phase = 'build';
    const buildOutput = fs.openSync(buildLog, 'w');
    try { buildAppIfNeeded({ stdio: ['ignore', buildOutput, buildOutput], env: isolatedEnvironment() }); }
    finally { fs.closeSync(buildOutput); }
    const configuredExecutable = process.env.LLM_TSUKURU_UI_HARNESS_EXECUTABLE;
    const executablePath = configuredExecutable ? path.resolve(configuredExecutable) : undefined;
    if (executablePath && !fs.existsSync(executablePath)) {
      throw new Error(`Packaged UI harness executable does not exist: ${executablePath}`);
    }

    copyDir(path.join(fixturesRoot, 'compare-project'), compareDir);
    copyDir(path.join(fixturesRoot, 'verify-project'), verifyDir);

    writeJson(scenarioPath, {
      compareDir,
      verifyDir,
      timeoutMs: 15000,
      ...(failureIndex !== -1 ? { expectedHomeHeading: '__intentional_harness_failure__' } : {}),
    });

    phase = 'electron';
    const exitCode = await runElectronHarness({
      ...isolatedEnvironment(),
      LLM_TSUKURU_STORE_DIR: storeDir,
      LLM_TSUKURU_UI_HARNESS_USER_DATA: userDataDir,
      LLM_TSUKURU_UI_HARNESS_SCENARIO: scenarioPath,
      LLM_TSUKURU_UI_HARNESS_RESULT: resultPath,
      LLM_TSUKURU_UI_HARNESS_TIMEOUT_MS: '45000',
    }, timeoutMs, executablePath, logPath);

    if (!fs.existsSync(resultPath)) {
      throw new Error('UI harness did not write a result file');
    }

    result = readJson(resultPath);
    assertUiEvidence(result, failureIndex !== -1);
    result.processExitCode = exitCode;
    if (exitCode !== 0) {
      result.status = 'failed';
      result.cases = [...(result.cases || []), {
        id: 'electron-exit', title: 'Electron exits cleanly after cleanup',
        status: 'failed', durationMs: 0, error: { message: `Electron exited with code ${exitCode}` },
      }];
    }
    result.artifacts = {
      ...(result.artifacts || {}),
      workspace: relativeArtifactPath(workspace),
      rawResult: relativeArtifactPath(resultPath),
      scenario: relativeArtifactPath(scenarioPath),
      electronLog: relativeArtifactPath(logPath),
    };
    result.metrics = {
      ...(result.metrics || {}),
      processExitCode: exitCode,
      executionMode: executablePath ? 'packaged' : 'development',
    };
    result.artifacts.executable = executablePath
      ? path.relative(projectRoot, executablePath)
      : relativeArtifactPath(electronExecutable(projectRoot));

  } catch (error) {
    result = {
      suite: 'harness-ui', status: 'failed', fatal: true, cases: [],
      error: { message: error.message, code: error.code, phase },
      processMayBeRunning: !!error.processMayBeRunning,
      failureHints: ['Run npm run doctor for environment failures; inspect the recorded phase, Electron log and progress artifact.'],
      metrics: { setupFailed: phase === 'build' },
      artifacts: {},
    };
  } finally {
    result.reproCommand = failureIndex === -1 ? 'npm run harness:ui' : 'npm run harness:ui -- --fail-at home';
    result.metrics = { ...result.metrics, ...(failureIndex !== -1 ? { requestedFault: 'home' } : {}) };
    result.artifacts = {
      ...result.artifacts, workspace: relativeArtifactPath(workspace),
      ...Object.fromEntries(Object.entries({
        buildLog, electronLog: logPath, scenario: scenarioPath,
        progress: path.join(workspace, 'progress.json'), diagnostics: path.join(workspace, 'diagnostics.json'),
      }).filter(([, file]) => fs.existsSync(file)).map(([key, file]) => [key, relativeArtifactPath(file)])),
    };
    try {
      if (result.processMayBeRunning) throw new Error('Owned Electron process may still be running; private state retained for explicit cleanup.');
      const logs = path.join(userDataDir, 'logs');
      if (fs.existsSync(logs)) fs.cpSync(logs, path.join(workspace, 'logs'), { recursive: true });
      removePrivateState(workspace);
      result.metrics = { ...result.metrics, privateStateRemoved: true };
    } catch (error) {
      result.status = 'failed';
      result.cases = [...(result.cases || []), {
        id: 'private-state-cleanup', title: 'Remove isolated profile and bridge credentials', status: 'failed',
        durationMs: 0, error: { message: error.message },
      }];
    }
    const normalized = writeHarnessResult('harness-ui', result);
    console.log(`[harness-ui] ${normalized.status}: ${normalized.artifacts.result}; workspace: ${workspace}`);
    process.exitCode = normalized.status === 'passed' ? 0 : 1;
  }
}

if (require.main === module) main().catch((error) => {
  writeFatalHarnessResult('harness-ui', error, {
    metrics: {
      setupFailed: true,
    },
  });
  process.exitCode = 1;
});
module.exports = { main, runElectronHarness, assertUiEvidence };
