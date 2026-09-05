const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { runDev } = require('../../scripts/dev.cjs');
const { isolatedEnvironment, electronExecutable, childCompletion, stopChild, shutdownChild, removePrivateState, withTimeout } = require('../../scripts/local-runtime.cjs');
const { assertUiEvidence, validateUiArgs } = require('../../scripts/harness/ui.cjs');

const scratch = path.resolve(__dirname, '../../artifacts/unit/local-runtime');
const roots = [];
function tempRoot() {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'run-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(scratch));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isolated runs remove inherited development, harness and personal profile overrides', () => {
  const original = {
    PATH: 'keep', VITE_DEV_SERVER_URL: 'http://other-checkout/', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_OVERRIDE_DIST_PATH: 'other-binary',
    LLM_TSUKURU_DEV_USER_DATA: 'personal', LLM_TSUKURU_UI_HARNESS_RESULT: 'previous-success',
    LLM_TSUKURU_STORE_DIR: 'personal-settings',
  };
  assert.deepEqual(isolatedEnvironment(original), { PATH: 'keep' });
  assert.equal(original.LLM_TSUKURU_STORE_DIR, 'personal-settings');
});

test('Electron resolution uses this checkout and rejects package metadata escaping its dist', () => {
  const root = tempRoot();
  const electron = path.join(root, 'node_modules/electron');
  fs.mkdirSync(path.join(electron, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(electron, 'dist/electron.exe'), 'fixture; never launched');
  fs.writeFileSync(path.join(electron, 'path.txt'), 'electron.exe');
  assert.equal(electronExecutable(root), path.join(electron, 'dist/electron.exe'));
  fs.writeFileSync(path.join(electron, 'path.txt'), '../package.json');
  assert.throws(() => electronExecutable(root), /outside this checkout/);
});

test('standalone UI rejects empty/skipped evidence and cannot pass an ignored fault probe', () => {
  const passed = { schemaVersion: 1, suite: 'harness-ui', status: 'passed', cases: [{ id: 'home', status: 'passed' }] };
  assert.doesNotThrow(() => assertUiEvidence(passed));
  assert.throws(() => assertUiEvidence({ ...passed, cases: [] }), /nonempty/);
  assert.throws(() => assertUiEvidence({ ...passed, cases: [{ status: 'skipped' }] }), /nonempty/);
  assert.throws(() => assertUiEvidence(passed, true), /fault was not exercised/);
  assert.doesNotThrow(() => assertUiEvidence({ ...passed, status: 'failed', cases: [] }, true));
});

test('UI arguments reject a fault command whose option names were lost by the shell', () => {
  assert.doesNotThrow(() => validateUiArgs(['--fail-at', 'home', '--output', 'result with spaces.json']));
  assert.throws(() => validateUiArgs(['home', 'result.json']), /Unexpected or incomplete argument/);
  assert.throws(() => validateUiArgs(['--fail-at']), /Unexpected or incomplete argument/);
  assert.throws(() => validateUiArgs(['--output']), /Unexpected or incomplete argument/);
});

test('private cleanup removes settings and credentials but preserves diagnostic evidence', () => {
  const root = tempRoot();
  for (const name of ['user-data', 'store', 'logs', 'fixture']) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'sentinel'), name);
  }
  removePrivateState(root);
  assert.equal(fs.existsSync(path.join(root, 'user-data')), false);
  assert.equal(fs.existsSync(path.join(root, 'store')), false);
  assert.equal(fs.readFileSync(path.join(root, 'fixture', 'sentinel'), 'utf8'), 'fixture');
  assert.equal(fs.readFileSync(path.join(root, 'logs', 'sentinel'), 'utf8'), 'logs');
});

test('child nonzero exits and timeouts cannot become successful completion', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(23)'], { stdio: 'ignore', windowsHide: true });
  const result = await withTimeout(childCompletion(child), 5000, 'child timeout');
  assert.ifError(result.error);
  assert.equal(result.code, 23);
  await assert.rejects(withTimeout(new Promise(() => {}), 10, 'intentional timeout'), /intentional timeout/);
});

test('a denied Windows tree stop still terminates the owned main handle and reports incomplete cleanup', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore', windowsHide: true });
  const completion = childCompletion(child);
  try {
    assert.ok(child.pid);
    if (process.platform === 'win32') {
      assert.throws(() => stopChild(child, () => ({ status: 1 })), /Could not confirm shutdown/);
    } else stopChild(child);
    await withTimeout(completion, 5000, 'owned process still alive');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { child.kill(); }
});

test('cooperative shutdown waits for the owned process before profile removal', async () => {
  const profile = tempRoot();
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs'), path = require('node:path');
    const timer = setInterval(() => {
      if (fs.existsSync(path.join(process.argv[1], 'stop'))) { clearInterval(timer); process.exit(0); }
    }, 25);
    setTimeout(() => process.exit(9), 4000).unref();
  `, profile], { stdio: 'ignore', windowsHide: true });
  const completion = childCompletion(child);
  try {
    await shutdownChild(child, completion, profile);
    assert.equal((await completion).code, 0);
  } finally { child.kill(); }
});

test('a shutdown-request write failure still waits for completion and remains a failure', async t => {
  const profile = tempRoot();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 250)'], { stdio: 'ignore', windowsHide: true });
  const completion = childCompletion(child);
  let exited = false;
  completion.then(() => { exited = true; });
  const originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (file === path.join(profile, 'stop')) throw new Error('intentional stop request write failure');
    return originalWrite(file, ...args);
  });
  try {
    await assert.rejects(shutdownChild(child, completion, profile), /intentional stop request write failure/);
    assert.equal(exited, true);
  } finally { child.kill(); }
});

// Vite/Electron are stand-ins here. These tests verify orchestration, real
// loopback ports, process exits and private-file cleanup, not application UI.
function launchStandIn(env, mode = 'ready') {
  return spawn(process.execPath, ['-e', `
    const fs = require('node:fs'), path = require('node:path');
    const profile = process.env.LLM_TSUKURU_DEV_USER_DATA;
    fs.mkdirSync(profile, { recursive: true });
    fs.mkdirSync(process.env.LLM_TSUKURU_STORE_DIR, { recursive: true });
    fs.writeFileSync(path.join(profile, 'private-sentinel'), 'not-for-reports');
    if (${JSON.stringify(mode)} !== 'early-exit') {
      fs.writeFileSync(path.join(profile, 'ready.json'), JSON.stringify({
        url: ${JSON.stringify(mode)} === 'wrong-url' ? 'http://other-checkout/#/' : process.env.VITE_DEV_SERVER_URL + '#/'
      }));
    }
    setTimeout(() => process.exit(0), 250);
  `], { env, stdio: 'ignore', windowsHide: true });
}

function serverFactory(record) {
  return async options => {
    record.options = options;
    const server = net.createServer();
    return {
      httpServer: server,
      listen: () => new Promise((resolve, reject) => {
        server.once('error', reject);
        // This stand-in only checks consumption of the assigned address.
        // Real Vite port fallback is covered in unit/devServer.test.ts.
        server.listen(0, options.server.host, resolve);
      }),
      close: () => new Promise(resolve => { server.close(resolve); record.closed = true; }),
    };
  };
}

test('fresh dev startup builds before launch, verifies renderer origin and cleans the profile', async () => {
  const root = tempRoot();
  const server = {};
  let built = false;
  const result = await runDev({
    root, smoke: true, build: () => { built = true; }, createServer: serverFactory(server),
    launch: env => { assert.equal(built, true); return launchStandIn(env); },
  });
  assert.equal(result.status, 'passed');
  assert.ok(result.readyAt);
  assert.deepEqual(server.options.server, { host: '127.0.0.1', port: 5173, strictPort: false });
  assert.equal(server.closed, true);
  assert.equal(result.privateStateRemoved, true);
  assert.equal(fs.existsSync(path.join(result.workspace, 'user-data')), false);
  assert.equal(fs.existsSync(path.join(result.workspace, 'store')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'artifacts/dev/latest.json'), 'utf8')).status, 'passed');
});

test('two checkout runs own different live ports and profiles', async () => {
  const runs = await Promise.all([tempRoot(), tempRoot()].map(root => runDev({
    root, smoke: true, build: () => {}, createServer: serverFactory({}), launch: env => launchStandIn(env),
  })));
  assert.deepEqual(runs.map(run => run.status), ['passed', 'passed']);
  assert.notEqual(runs[0].url, runs[1].url);
  assert.notEqual(runs[0].workspace, runs[1].workspace);
});

for (const mode of ['wrong-url', 'early-exit']) {
  test(`dev rejects ${mode} instead of reporting ready and still closes server/profile`, async () => {
    const server = {};
    const result = await runDev({
      root: tempRoot(), smoke: true, build: () => {}, createServer: serverFactory(server),
      launch: env => launchStandIn(env, mode), timeoutMs: 2000,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.error.phase, 'electron-startup');
    assert.equal(result.privateStateRemoved, true);
    assert.equal(server.closed, true);
  });
}

test('a build failure records the original cause and never launches a server or Electron', async () => {
  const failure = Object.assign(new Error('intentional build failure'), { code: 'E_BUILD_PROBE' });
  const result = await runDev({
    root: tempRoot(), build: () => { throw failure; },
    createServer: () => assert.fail('build failure must block Vite'),
    launch: () => assert.fail('build failure must block Electron'),
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.error, { message: failure.message, code: failure.code, phase: 'build' });
  assert.equal(result.privateStateRemoved, true);
});

test('report write failure after launch cannot bypass process, server or profile cleanup', async t => {
  const root = tempRoot();
  const server = {};
  const originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, data, ...args) => {
    if (String(file).endsWith('result.json') && /"phase": "(running|cleanup)"/.test(String(data))) {
      throw new Error('intentional report write failure');
    }
    return originalWrite(file, data, ...args);
  });
  await assert.rejects(runDev({
    root, smoke: true, build: () => {}, createServer: serverFactory(server), launch: env => launchStandIn(env),
  }), /intentional report write failure/);
  assert.equal(server.closed, true);
  const runs = path.join(root, 'artifacts/dev');
  const workspace = fs.readdirSync(runs).find(name => name.startsWith('run-'));
  assert.ok(workspace);
  assert.equal(fs.existsSync(path.join(runs, workspace, 'user-data')), false);
  assert.equal(fs.existsSync(path.join(runs, workspace, 'store')), false);
});
