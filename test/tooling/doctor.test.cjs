const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { inspectRuntime, inspectManifests, inspectDependencies, inspectElectron, probeWritable, probeChildProcess, probeLoopback, runDoctor, main } = require('../../scripts/doctor.cjs');

const scratch = path.resolve(__dirname, '../../artifacts/unit/doctor');
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(scratch));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'run-'));
  temporaryRoots.push(root);
  const manifest = { name: 'doctor-fixture', version: '1.0.0', dependencies: { vue: '^3.0.0' }, devDependencies: { electron: '^40.0.0' } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3, packages: { '': manifest, 'node_modules/vue': { version: '3.5.0' }, 'node_modules/electron': { version: '40.6.1' } },
  }));
  for (const [name, version] of [['vue', '3.5.0'], ['electron', '40.6.1']]) {
    fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }
  fs.mkdirSync(path.join(root, 'node_modules', 'electron', 'dist'));
  fs.writeFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'electron.exe\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), 'fixture only; never executed');
  return root;
}

function fakeServer(failure) {
  const server = new EventEmitter();
  server.address = mock.fn(() => ({ port: 49152 }));
  server.listen = mock.fn((_options, callback) => {
    queueMicrotask(() => failure ? server.emit('error', Object.assign(new Error('private error detail'), { code: failure })) : callback());
    return server;
  });
  server.close = mock.fn((callback) => { queueMicrotask(() => callback()); return server; });
  return server;
}

test('doctor distinguishes the CI runtime from checks on a different current machine', () => {
  assert.equal(inspectRuntime('v22.13.0', 'win32').status, 'passed');
  const old = inspectRuntime('v22.12.0', 'win32');
  assert.equal(old.status, 'warning');
  assert.equal(old.supportedNode, false);
  const newer = inspectRuntime('v24.14.0', 'win32');
  assert.equal(newer.status, 'warning');
  assert.equal(newer.supportedNode, false);
  assert.equal(newer.supportedPlatform, true);
  const linux = inspectRuntime('v22.20.0', 'linux');
  assert.equal(linux.status, 'warning');
  assert.equal(linux.supportedNode, true);
  assert.equal(linux.supportedPlatform, false);
});

test('doctor detects manifest drift and stale or missing local dependencies independently', () => {
  const root = fixture();
  assert.equal(inspectManifests(root).status, 'passed');
  assert.equal(inspectDependencies(root).status, 'passed');
  const file = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.devDependencies.electron = '^41.0.0';
  fs.writeFileSync(file, JSON.stringify(manifest));
  const drift = inspectManifests(root);
  assert.equal(drift.status, 'failed');
  assert.equal(drift.code, 'MANIFEST_LOCK_MISMATCH');
  assert.deepEqual(drift.mismatches, ['devDependencies.electron']);
  fs.rmSync(path.join(root, 'node_modules', 'vue', 'package.json'));
  fs.writeFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), JSON.stringify({ version: '39.0.0' }));
  const dependencies = inspectDependencies(root);
  assert.equal(dependencies.status, 'failed');
  assert.deepEqual(dependencies.missing, ['vue']);
  assert.deepEqual(dependencies.mismatched, ['electron']);
});

test('doctor requires the installed Electron executable in addition to package metadata', () => {
  const root = fixture();
  assert.equal(inspectElectron(root).code, 'ELECTRON_BINARY_PRESENT');
  fs.rmSync(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'));
  const missing = inspectElectron(root);
  assert.equal(missing.status, 'failed');
  assert.equal(missing.code, 'ELECTRON_BINARY_MISSING');
  assert.equal(missing.errorCode, 'ENOENT');
  fs.writeFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), '../../../package.json');
  assert.equal(inspectElectron(root).code, 'ELECTRON_PATH_INVALID');
});

test('doctor cleans its temporary directory after both successful and denied writes', () => {
  const root = fixture();
  const before = fs.readdirSync(root).sort();
  const ready = probeWritable(root);
  assert.equal(ready.status, 'passed');
  assert.equal(ready.cleaned, true);
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  const denied = { ...fs, writeFileSync: () => { throw Object.assign(new Error('private path or setting'), { code: 'EACCES' }); } };
  const failure = probeWritable(root, denied);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.errorCode, 'EACCES');
  assert.deepEqual(fs.readdirSync(root).sort(), before);
});

test('doctor reports cleanup failure instead of claiming that a writable probe passed', () => {
  const root = fixture();
  const denied = { ...fs, rmSync: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } };
  const check = probeWritable(root, denied);
  assert.equal(check.status, 'failed');
  assert.equal(check.code, 'WRITE_PROBE_CLEANUP_FAILED');
  assert.equal(check.cleanupErrorCode, 'EPERM');
  assert.equal(path.dirname(check.temporaryPath), root);
});

test('doctor separates denied process creation from a command that ran and failed without leaking its output', () => {
  const execute = mock.fn(() => ({ error: Object.assign(new Error('secret stderr'), { code: 'EPERM' }), status: null, stderr: 'private credential' }));
  const blocked = probeChildProcess('node', ['-e', '0'], 'ready', process.cwd(), execute);
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.code, 'PROCESS_PIPE_DENIED');
  assert.equal(blocked.phase, 'spawn');
  assert.equal(blocked.errorCode, 'EPERM');
  const options = execute.mock.calls[0].arguments[2];
  assert.equal(options.shell, false);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(options.timeout, 5000);
  assert.doesNotMatch(JSON.stringify(blocked), /secret stderr|private credential/);
  const exited = probeChildProcess('git', [], 'ready', process.cwd(), () => ({ status: 7, stdout: '', stderr: 'private credential' }));
  assert.equal(exited.status, 'failed');
  assert.equal(exited.code, 'PROCESS_EXIT_NONZERO');
  assert.equal(exited.phase, 'exit');
  assert.equal(exited.exitCode, 7);
  assert.equal(probeChildProcess('node', [], 'ready', process.cwd(), () => ({ status: 0, stdout: 'other' })).code, 'PROCESS_OUTPUT_MISMATCH');
});

test('doctor closes an ephemeral loopback socket on both readiness and listen failure', async () => {
  for (const code of [undefined, 'EACCES']) {
    const server = fakeServer(code);
    const check = await probeLoopback(() => server);
    assert.equal(check.status, code ? 'failed' : 'passed');
    if (code) assert.equal(check.errorCode, code);
    else assert.equal(check.cleaned, true);
    assert.deepEqual(server.listen.mock.calls[0].arguments[0], { host: '127.0.0.1', port: 0, exclusive: true });
    assert.equal(typeof server.listen.mock.calls[0].arguments[1], 'function');
    assert.equal(server.close.mock.callCount(), 1);
  }
});

test('doctor releases a real ephemeral socket for immediate reuse', async () => {
  const check = await probeLoopback();
  assert.equal(check.status, 'passed');
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: check.port, exclusive: true }, resolve);
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('doctor collects remaining checks after failures and reports only environment variable names', async () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'node_modules', 'vue', 'package.json'));
  const server = fakeServer();
  const report = await runDoctor({
    root, tempDirectory: root, nodeVersion: 'v24.14.0', platform: 'win32', createServer: () => server,
    env: { NODE_OPTIONS: 'private-value', OPENAI_API_KEY: 'secret-value' },
    spawnSync: () => ({ error: Object.assign(new Error('private-value'), { code: 'EPERM' }) }),
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.length, 10);
  assert.equal(report.checks.find(check => check.id === 'dependencies').status, 'failed');
  assert.equal(report.checks.find(check => check.id === 'loopback').status, 'passed');
  assert.deepEqual(report.checks.find(check => check.id === 'environment').names, ['NODE_OPTIONS']);
  assert.doesNotMatch(JSON.stringify(report), /private-value|secret-value/);
  assert.equal(server.close.mock.callCount(), 1);
});

test('doctor returns a nonzero CLI result and persists the failed checks for diagnosis', async () => {
  const root = fixture();
  const exitCode = await main([], {
    root, tempDirectory: root, nodeVersion: 'v22.13.0', platform: 'win32', env: {},
    createServer: () => fakeServer(), spawnSync: () => ({ status: 7, stdout: '', stderr: 'private-value' }),
    log: mock.fn(), logError: mock.fn(),
  });
  assert.equal(exitCode, 1);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'doctor', 'latest.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  const git = report.checks.find(check => check.id === 'git');
  assert.equal(git.code, 'PROCESS_EXIT_NONZERO');
  assert.equal(git.exitCode, 7);
  assert.doesNotMatch(JSON.stringify(report), /private-value/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'artifacts', 'doctor')), ['latest.json']);
});

test('doctor does not report a successful artifact when the report cannot be written', async () => {
  const root = fixture();
  const log = mock.fn();
  const logError = mock.fn();
  const io = { ...fs, mkdirSync: () => { throw Object.assign(new Error('private detail'), { code: 'EACCES' }); } };
  const exitCode = await main([], {
    root, tempDirectory: root, nodeVersion: 'v22.13.0', platform: 'win32', env: {}, fs: io,
    createServer: () => fakeServer(),
    spawnSync: command => ({ status: 0, stdout: command === 'git' ? 'true' : 'TSUKURU_DOCTOR_PIPE_OK' }),
    log, logError,
  });
  assert.equal(exitCode, 1);
  assert.ok(logError.mock.calls.some(call => call.arguments[0].includes('REPORT_WRITE_FAILED (EACCES)')));
  assert.equal(log.mock.calls.at(-1).arguments[0], '[doctor] failed: report artifact was not updated');
});
