#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runCommand } = require('./harness/_shared.cjs');
const { isolatedEnvironment, electronExecutable, childCompletion, shutdownChild, removePrivateState, withTimeout } = require('./local-runtime.cjs');

function waitForReady(file, completion, timeoutMs) {
  let interval;
  return withTimeout(Promise.race([
    new Promise((resolve, reject) => {
      interval = setInterval(() => {
        if (!fs.existsSync(file)) return;
        try { resolve(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (error) { reject(error); }
      }, 100);
    }),
    completion.then(result => { throw result.error || new Error(`Electron exited before renderer readiness (exit ${result.code}).`); }),
  ]), timeoutMs, `Renderer did not send mainReady within ${timeoutMs}ms.`).finally(() => clearInterval(interval));
}

async function runDev(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const runs = path.join(root, 'artifacts', 'dev');
  fs.mkdirSync(runs, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(runs, 'run-'));
  const reportPath = path.join(workspace, 'result.json');
  const report = { schemaVersion: 1, status: 'starting', startedAt: new Date().toISOString(), workspace, reportPath };
  const buildLog = path.join(workspace, 'build.log');
  report.buildLog = buildLog;
  const save = () => {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(runs, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  };
  const env = isolatedEnvironment(options.env);
  let server;
  let child;
  let completion;
  let stopping;
  const shutdown = () => completion
    ? (stopping ||= shutdownChild(child, completion, path.join(workspace, 'user-data')))
    : Promise.resolve();
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void shutdown().catch(error => { report.cleanupError = error.message; });
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    save();
    report.phase = 'build'; save();
    const build = options.build || (() => {
      const log = fs.openSync(buildLog, 'w');
      try {
        console.log(`[dev] Building main/MCP; log: ${buildLog}`);
        runCommand('npm', ['run', 'build:ts'], { cwd: root, env, stdio: ['ignore', log, log] });
        runCommand('npm', ['run', 'build:mcp'], { cwd: root, env, stdio: ['ignore', log, log] });
      } finally { fs.closeSync(log); }
    });
    await build();
    if (interrupted) throw new Error('Development startup interrupted.');
    report.phase = 'renderer-server'; save();
    const createServer = options.createServer || (await import('vite')).createServer;
    server = await createServer({
      configFile: path.join(root, 'vite.renderer.config.ts'),
      // The listening server owns the allocated port; no reserve/release race.
      server: { host: '127.0.0.1', port: 0, strictPort: true },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not expose its listening port.');
    const url = `http://127.0.0.1:${address.port}/`;
    if (interrupted) throw new Error('Development startup interrupted.');
    report.url = url;
    report.phase = 'electron-startup'; save();
    const profile = path.join(workspace, 'user-data');
    const launch = options.launch || ((childEnv) => spawn(electronExecutable(root), ['.'], {
      cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true, shell: false,
    }));
    child = launch({
      ...env, VITE_DEV_SERVER_URL: url, LLM_TSUKURU_DEV_USER_DATA: profile,
      LLM_TSUKURU_STORE_DIR: path.join(workspace, 'store'),
      ...(options.smoke ? { LLM_TSUKURU_DEV_SMOKE: '1' } : {}),
    });
    completion = childCompletion(child);
    report.pid = child.pid; save();
    const ready = await waitForReady(path.join(profile, 'ready.json'), completion, options.timeoutMs || 30000);
    if (ready.url !== `${url}#/`) throw new Error('Electron loaded a different renderer from this run.');
    report.readyAt = new Date().toISOString();
    report.status = 'ready'; report.phase = 'running'; save();
    console.log(`[dev] Electron renderer ready: ${url} (PID ${child.pid}). Close the app or press Ctrl+C to stop.`);
    const result = options.smoke
      ? await withTimeout(completion, 10000, 'Smoke app did not exit after readiness.')
      : await completion;
    if (result.error) throw result.error;
    if (!interrupted && result.code !== 0) throw new Error(`Electron exited with code ${result.code}, signal ${result.signal}.`);
    report.status = interrupted ? 'interrupted' : options.smoke ? 'passed' : 'stopped';
  } catch (error) {
    report.status = 'failed';
    report.error = { message: error.message, code: error.code, phase: report.phase };
    report.failureHint = 'Run npm run doctor; inspect this run and its isolated logs. Main/preload changes require restarting npm run dev.';
  } finally {
    report.phase = 'cleanup';
    try { save(); } catch (error) { report.status = 'failed'; report.reportError = error.message; }
    try {
      await shutdown();
      // Keep diagnostic logs, not the settings/key/bridge/session profile.
      const logs = path.join(workspace, 'user-data', 'logs');
      if (fs.existsSync(logs)) fs.cpSync(logs, path.join(workspace, 'logs'), { recursive: true });
      removePrivateState(workspace);
      report.privateStateRemoved = true;
    } catch (error) { report.status = 'failed'; report.cleanupError = error.message; }
    try { await server?.close(); } catch (error) { report.status = 'failed'; report.serverCleanupError = error.message; }
    if (report.cleanupError || report.serverCleanupError || report.reportError) report.status = 'failed';
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    report.completedAt = new Date().toISOString();
    save();
  }
  return report;
}

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--smoke')) throw new Error('Use npm run dev or npm run dev -- --smoke.');
  const result = await runDev({ smoke: args.includes('--smoke') });
  console.log(`[dev] ${result.status}: ${result.reportPath}`);
  if (result.error) console.error(`[dev] ${result.error.phase}: ${result.error.message}`);
  process.exitCode = ['passed', 'stopped'].includes(result.status) ? 0 : 1;
}

module.exports = { runDev, waitForReady, main };
if (require.main === module) main().catch(error => { console.error(`[dev] ${error.message}`); process.exitCode = 1; });
