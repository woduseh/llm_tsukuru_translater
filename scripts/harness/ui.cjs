#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');

const {
  buildAppIfNeeded,
  copyDir,
  makeTempDir,
  projectRoot,
  readJson,
  resolveOutputPath,
  writeJson,
} = require('./_shared.cjs');

async function runElectronHarness(env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, ['.'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`UI harness timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  buildAppIfNeeded();

  const workspace = makeTempDir('llm-tsukuru-ui-');
  const fixturesRoot = path.join(projectRoot, 'test', 'fixtures', 'harness', 'ui');
  const compareDir = path.join(workspace, 'compare-project');
  const verifyDir = path.join(workspace, 'verify-project');
  const resultPath = path.join(workspace, 'harness-ui-result.json');
  const scenarioPath = path.join(workspace, 'harness-ui-scenario.json');
  const storeDir = path.join(workspace, 'store');
  const timeoutMs = 45000;

  copyDir(path.join(fixturesRoot, 'compare-project'), compareDir);
  copyDir(path.join(fixturesRoot, 'verify-project'), verifyDir);

  writeJson(scenarioPath, {
    compareDir,
    verifyDir,
    timeoutMs: 15000,
  });

  const exitCode = await runElectronHarness({
    ...process.env,
    LLM_TSUKURU_STORE_DIR: storeDir,
    LLM_TSUKURU_UI_HARNESS_SCENARIO: scenarioPath,
    LLM_TSUKURU_UI_HARNESS_RESULT: resultPath,
    LLM_TSUKURU_UI_HARNESS_TIMEOUT_MS: '45000',
  }, timeoutMs);

  if (!fs.existsSync(resultPath)) {
    throw new Error('UI harness did not write a result file');
  }

  const result = readJson(resultPath);
  result.processExitCode = exitCode;

  const outputPath = resolveOutputPath('harness-ui');
  writeJson(outputPath, result);
  process.exitCode = result.status === 'passed' && exitCode === 0 ? 0 : 1;
}

main().catch((error) => {
  const outputPath = resolveOutputPath('harness-ui');
  writeJson(outputPath, {
    suite: 'harness-ui',
    status: 'failed',
    fatal: true,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
  process.exitCode = 1;
});
