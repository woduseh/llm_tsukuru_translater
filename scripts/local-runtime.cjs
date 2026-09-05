const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// These values can silently redirect a local run to another checkout/profile.
function isolatedEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith('LLM_TSUKURU_UI_HARNESS_') || key.startsWith('LLM_TSUKURU_DEV_')
      || ['VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_OVERRIDE_DIST_PATH', 'LLM_TSUKURU_STORE_DIR'].includes(key)) delete env[key];
  }
  return env;
}

function electronExecutable(root) {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  const relative = fs.readFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'utf8').trim();
  const executable = path.resolve(dist, relative);
  const within = path.relative(dist, executable);
  if (!relative || !within || within === '..' || within.startsWith('..' + path.sep) || path.isAbsolute(within)
    || !fs.statSync(executable).isFile()) throw new Error('The local Electron binary is missing or outside this checkout. Run npm ci.');
  return executable;
}

function childCompletion(child) {
  return new Promise(resolve => {
    let error;
    child.once('error', value => { error = value; });
    child.once('close', (code, signal) => resolve({ code, signal, error }));
  });
}

// Only receives a process this runner created. Never searches/kills by app name.
function stopChild(child, terminateTree = (pid) => spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
  stdio: 'ignore', windowsHide: true, shell: false,
})) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = terminateTree(child.pid);
    if (result.error) {
      child.kill();
      throw result.error;
    }
    // The process may have exited between the status check and taskkill.
    if (result.status !== 0) {
      try { process.kill(child.pid, 0); } catch (error) {
        if (error.code === 'ESRCH') return;
        child.kill();
        throw error;
      }
      // The owned main handle is still usable in restricted Windows sessions.
      // Terminate it, but do not claim its descendants were also confirmed dead.
      child.kill();
      throw new Error(`Could not confirm shutdown of process tree ${child.pid} (taskkill exit ${result.status}); owned main process was terminated.`);
    }
  } else if (!child.kill('SIGTERM')) {
    throw new Error(`Could not stop owned process ${child.pid}.`);
  }
}

async function shutdownChild(child, completion, profile) {
  if (!completion) return;
  let shutdownError;
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try {
      if (profile && fs.existsSync(profile)) fs.writeFileSync(path.join(profile, 'stop'), '');
    } catch (error) { shutdownError = error; }
    const timedOut = Symbol('shutdown timeout');
    let timer;
    const result = await Promise.race([
      completion,
      new Promise(resolve => { timer = setTimeout(() => resolve(timedOut), 1500); }),
    ]).finally(() => clearTimeout(timer));
    if (result === timedOut) {
      try { stopChild(child); } catch (error) { shutdownError = error; }
    }
  }
  await withTimeout(completion, 10000, 'Owned Electron process did not stop; profile retained.');
  if (shutdownError) throw shutdownError;
}

function removePrivateState(workspace) {
  const root = fs.realpathSync(workspace);
  for (const name of ['user-data', 'store']) {
    const target = path.resolve(root, name);
    if (!fs.existsSync(target)) continue;
    // Do not follow junctions or delete anything outside this generated run.
    const actual = fs.realpathSync(target);
    if (fs.lstatSync(target).isSymbolicLink() || path.dirname(actual) !== root) {
      throw new Error(`Refusing to clean a profile outside its run directory: ${name}`);
    }
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { isolatedEnvironment, electronExecutable, childCompletion, stopChild, shutdownChild, removePrivateState, withTimeout };
