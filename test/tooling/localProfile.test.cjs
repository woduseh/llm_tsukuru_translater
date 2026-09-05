const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/harness/uiHarnessEnvironment.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const scratch = path.resolve(__dirname, '../../artifacts/unit/local-profile');
const profiles = [];
const apps = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.emit('will-quit');
  for (const profile of profiles.splice(0)) {
    assert.equal(path.dirname(fs.realpathSync(profile)), fs.realpathSync(scratch));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
function profile() {
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'run-'));
  profiles.push(directory);
  return directory;
}

// Execute the actual bootstrap module with Electron lifecycle stand-ins.
// No application or visual correctness claim is made by these tests.
function boot(env, packaged = false) {
  const app = new EventEmitter();
  app.isPackaged = packaged;
  app.paths = {};
  app.setPath = (name, value) => { app.paths[name] = value; };
  app.setAppLogsPath = value => { app.paths.logs = value; };
  app.quit = () => { app.emit('quit-requested'); app.emit('will-quit'); };
  apps.push(app);
  const ipcMain = new EventEmitter();
  vm.runInNewContext(compiled, {
    exports: {}, process: { env }, setInterval, clearInterval, setTimeout,
    require: name => name === 'electron' ? { app, ipcMain } : require(name),
  });
  return { app, ipcMain };
}

test('ordinary and packaged app starts do not adopt a development profile or readiness listener', () => {
  assert.deepEqual(boot({}).app.paths, {});
  const packaged = boot({ LLM_TSUKURU_DEV_USER_DATA: profile() }, true);
  assert.deepEqual(packaged.app.paths, {});
  assert.equal(packaged.ipcMain.listenerCount('mainReady'), 0);
});

test('dev profile isolates logs/session and confirms readiness only after production mainReady', async () => {
  const directory = profile();
  const { app, ipcMain } = boot({ LLM_TSUKURU_DEV_USER_DATA: directory, LLM_TSUKURU_DEV_SMOKE: '1' });
  assert.deepEqual(app.paths, { userData: directory, sessionData: path.join(directory, 'session'), logs: path.join(directory, 'logs') });
  assert.equal(fs.existsSync(path.join(directory, 'ready.json')), false);
  const stopped = new Promise(resolve => app.once('quit-requested', resolve));
  ipcMain.emit('mainReady', { sender: { getURL: () => 'http://127.0.0.1:1234/#/' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'ready.json'), 'utf8')), { url: 'http://127.0.0.1:1234/#/' });
  await stopped;
});

test('a runner-owned stop file requests normal application shutdown', async () => {
  const directory = profile();
  const { app } = boot({ LLM_TSUKURU_UI_HARNESS_SCENARIO: 'fixture', LLM_TSUKURU_UI_HARNESS_USER_DATA: directory });
  const stopped = new Promise(resolve => app.once('quit-requested', resolve));
  fs.writeFileSync(path.join(directory, 'stop'), '');
  // The real polling timer is unref'ed; keep this assertion bounded and alive.
  let timer;
  try {
    await Promise.race([stopped, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('shutdown request ignored')), 1000); })]);
  } finally { clearTimeout(timer); }
});

test('local runners reject relative profile paths before changing Electron state', () => {
  assert.throws(() => boot({ LLM_TSUKURU_DEV_USER_DATA: 'relative-profile' }), /absolute isolated/);
});
