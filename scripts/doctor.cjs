#!/usr/bin/env node
// Local prerequisites only: no installs, external requests, or application tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const affectingVariables = [
  'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_OVERRIDE_DIST_PATH',
  'ELECTRON_SKIP_BINARY_DOWNLOAD', 'VITE_DEV_SERVER_URL',
  'LLM_TSUKURU_SKIP_BUILD', 'LLM_TSUKURU_UI_HARNESS_EXECUTABLE',
  'LLM_TSUKURU_PACKAGE_SMOKE', 'LLM_TSUKURU_LIVE_PROVIDER',
  'npm_config_ignore_scripts', 'npm_config_omit',
];

function errorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'UNKNOWN_ERROR';
}

function result(status, code, message, details = {}, hint) {
  return { status, code, message, ...details, ...(hint ? { hint } : {}) };
}

function inspectRuntime(version, platform) {
  const parsed = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const supportedNode = !!parsed && Number(parsed[1]) === 22 && Number(parsed[2]) >= 13;
  const supportedPlatform = platform === 'win32';
  return result(supportedNode && supportedPlatform ? 'passed' : 'warning',
    supportedNode && supportedPlatform ? 'CI_RUNTIME_MATCH' : 'OUTSIDE_CI_RUNTIME',
    'CI covers Windows and Node 22.x (22.13.0 or newer). Other runtime checks describe this machine only.',
    { node: version, platform, supportedNode, supportedPlatform },
    supportedNode && supportedPlatform ? undefined : 'Use the documented Windows / Node 22.x environment when CI parity is required.');
}

function inspectManifests(root, io = fs) {
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  let manifest;
  let lock;
  try {
    manifest = JSON.parse(io.readFileSync(packagePath, 'utf8'));
    lock = JSON.parse(io.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return result('failed', 'MANIFEST_READ_FAILED', 'Cannot read package.json and package-lock.json.',
      { paths: [packagePath, lockPath], errorCode: errorCode(error) }, 'Restore valid manifests before installing dependencies.');
  }
  const locked = lock.packages?.[''];
  if (!locked) {
    return result('failed', 'LOCK_ROOT_MISSING', 'The lockfile has no root package record.',
      { path: lockPath }, 'Regenerate the lockfile in the supported Node environment, then review the diff.');
  }
  const mismatches = [];
  for (const key of ['name', 'version']) {
    if (manifest[key] !== locked[key]) mismatches.push(key);
  }
  for (const section of dependencySections) {
    const wanted = manifest[section] || {};
    const installed = locked[section] || {};
    for (const name of new Set([...Object.keys(wanted), ...Object.keys(installed)])) {
      if (wanted[name] !== installed[name]) mismatches.push(`${section}.${name}`);
    }
  }
  return mismatches.length
    ? result('failed', 'MANIFEST_LOCK_MISMATCH', 'Manifest and lockfile declarations differ.',
      { paths: [packagePath, lockPath], mismatches: mismatches.sort() }, 'Synchronize package-lock.json and review the diff before running npm ci.')
    : result('passed', 'MANIFEST_LOCK_MATCH', 'Manifest and lockfile dependency declarations agree.', { paths: [packagePath, lockPath] });
}

function inspectDependencies(root, io = fs) {
  let manifest;
  let lock;
  try {
    manifest = JSON.parse(io.readFileSync(path.join(root, 'package.json'), 'utf8'));
    lock = JSON.parse(io.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  } catch (error) {
    return result('failed', 'DEPENDENCIES_UNREADABLE', 'Dependency inspection requires readable manifests.',
      { errorCode: errorCode(error) }, 'Resolve the manifest check first.');
  }
  const required = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
  const missing = [];
  const mismatched = [];
  const unreadable = [];
  for (const name of required) {
    const packagePath = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
    try {
      const installed = JSON.parse(io.readFileSync(packagePath, 'utf8'));
      const locked = lock.packages?.[`node_modules/${name}`];
      if (!locked || installed.version !== locked.version) mismatched.push(name);
    } catch (error) {
      if (error.code === 'ENOENT') missing.push(name);
      else unreadable.push({ name, errorCode: errorCode(error) });
    }
  }
  return missing.length || mismatched.length || unreadable.length
    ? result('failed', 'DEPENDENCIES_NOT_READY', 'Required local dependencies are missing or differ from the lockfile.',
      { path: path.join(root, 'node_modules'), requiredCount: required.length, missing, mismatched, unreadable },
      'Run npm ci in this checkout with development dependencies and install scripts enabled; this command does not install anything.')
    : result('passed', 'DEPENDENCIES_READY', 'Required direct dependencies match the lockfile in this checkout.', { requiredCount: required.length });
}

function inspectElectron(root, io = fs) {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  let binaryPath;
  try {
    const binary = io.readFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'utf8').trim();
    binaryPath = path.resolve(dist, binary);
    const relative = path.relative(dist, binaryPath);
    if (!binary || relative === '' || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      return result('failed', 'ELECTRON_PATH_INVALID', 'Electron install metadata does not identify a file inside its dist directory.',
        { path: dist }, 'Run npm ci with Electron install scripts enabled.');
    }
    const stat = io.statSync(binaryPath);
    if (!stat.isFile() || stat.size === 0) {
      return result('failed', 'ELECTRON_BINARY_INVALID', 'Electron executable is empty or is not a file.',
        { path: binaryPath }, 'Run npm ci with Electron install scripts enabled.');
    }
    return result('passed', 'ELECTRON_BINARY_PRESENT', 'The installed Electron executable exists; application startup is checked by the UI harness.',
      { path: binaryPath });
  } catch (error) {
    return result('failed', 'ELECTRON_BINARY_MISSING', 'Electron package metadata or its executable is unavailable.',
      { path: binaryPath || dist, errorCode: errorCode(error) }, 'Run npm ci with Electron install scripts enabled; the binary download needs network access.');
  }
}

function probeWritable(directory, io = fs) {
  let temporary;
  let failure;
  let cleanupFailure;
  try {
    temporary = io.mkdtempSync(path.join(directory, '.tsukuru-doctor-'));
    const file = path.join(temporary, 'probe');
    io.writeFileSync(file, 'tsukuru-doctor\n', { flag: 'wx' });
    if (io.readFileSync(file, 'utf8') !== 'tsukuru-doctor\n') failure = 'READBACK_MISMATCH';
  } catch (error) {
    failure = errorCode(error);
  } finally {
    if (temporary) {
      // Only remove the directory returned by our own mkdtemp, never its parent.
      try { io.rmSync(temporary, { recursive: true, force: true }); }
      catch (error) { cleanupFailure = errorCode(error); }
    }
  }
  if (failure || cleanupFailure) {
    return result('failed', cleanupFailure ? 'WRITE_PROBE_CLEANUP_FAILED' : 'DIRECTORY_NOT_WRITABLE',
      'A temporary write/read/remove probe failed.',
      { path: directory, ...(failure ? { errorCode: failure } : {}), ...(cleanupFailure ? { cleanupErrorCode: cleanupFailure, temporaryPath: temporary } : {}) },
      'Check this directory and the current process permissions; no permission settings were changed.');
  }
  return result('passed', 'DIRECTORY_WRITABLE', 'Temporary write, read, and removal succeeded.', { path: directory, cleaned: true });
}

function probeChildProcess(command, args, expectedOutput, root, execute = spawnSync) {
  let child;
  try {
    child = execute(command, args, {
      cwd: root, encoding: 'utf8', windowsHide: true, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 64 * 1024,
    });
  } catch (error) {
    child = { error };
  }
  // Never include child stdout/stderr or an exception message: inherited Node
  // options, Git configuration, or external tools can echo private values.
  if (child.error) {
    const code = errorCode(child.error);
    return result('failed', ['EPERM', 'EACCES'].includes(code) ? 'PROCESS_PIPE_DENIED' : 'PROCESS_START_FAILED',
      'A child process with piped output could not start or finish.',
      { command, phase: 'spawn', errorCode: code },
      ['EPERM', 'EACCES'].includes(code)
        ? 'The current execution environment blocks this process/pipe operation. Vite, esbuild and Git-backed verification need it; use an authorized execution environment.'
        : 'Check command availability and process restrictions. This is a prerequisite probe, not a repository test result.');
  }
  if (child.status !== 0) {
    return result('failed', 'PROCESS_EXIT_NONZERO', 'The prerequisite probe started but exited unsuccessfully.',
      { command, phase: 'exit', exitCode: child.status, signal: child.signal || null },
      'Inspect command availability or repository configuration. No product test was run by this probe.');
  }
  if (String(child.stdout).trim() !== expectedOutput) {
    return result('failed', 'PROCESS_OUTPUT_MISMATCH', 'The prerequisite probe did not return its expected readiness marker.',
      { command, phase: 'output' }, 'Check runtime options and whether this directory is a Git working tree.');
  }
  return result('passed', 'PROCESS_PIPE_READY', 'The child process exited successfully and returned its expected output through a pipe.', { command });
}

function probeLoopback(createServer = () => net.createServer(socket => socket.destroy()), timeoutMs = 3000) {
  return new Promise(resolve => {
    let server;
    let timer;
    let finishing = false;
    let boundPort;
    const finish = (failure) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      const complete = (cleanupError) => {
        const cleanupCode = cleanupError && cleanupError.code !== 'ERR_SERVER_NOT_RUNNING' ? errorCode(cleanupError) : undefined;
        resolve(failure || cleanupCode
          ? result('failed', cleanupCode ? 'LOOPBACK_CLEANUP_FAILED' : 'LOOPBACK_UNAVAILABLE',
            'The loopback bind/close probe failed.', { host: '127.0.0.1', ...(failure ? { errorCode: failure } : {}), ...(cleanupCode ? { cleanupErrorCode: cleanupCode } : {}) },
            'A local ephemeral TCP listener is required by the application harness. Check the current environment restrictions.')
          : result('passed', 'LOOPBACK_READY', 'An ephemeral loopback port was bound and closed.', { host: '127.0.0.1', port: boundPort, cleaned: true }));
      };
      if (!server) { complete(); return; }
      try { server.close(complete); }
      catch (error) { complete(error); }
    };
    try {
      server = createServer();
      server.once('error', error => finish(errorCode(error)));
      timer = setTimeout(() => finish('ETIMEDOUT'), timeoutMs);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        boundPort = server.address()?.port;
        finish();
      });
    } catch (error) { finish(errorCode(error)); }
  });
}

async function runDoctor(options = {}) {
  const root = path.resolve(options.root || projectRoot);
  const io = options.fs || fs;
  const environment = options.env || process.env;
  const started = Date.now();
  const checks = [];
  const run = async (id, inspect) => {
    const checkStarted = Date.now();
    try { checks.push({ id, ...await inspect(), durationMs: Date.now() - checkStarted }); }
    catch (error) {
      checks.push({ id, ...result('failed', 'PROBE_ERROR', 'The prerequisite probe failed unexpectedly.', { errorCode: errorCode(error) }), durationMs: Date.now() - checkStarted });
    }
  };
  await run('runtime', () => inspectRuntime(options.nodeVersion || process.version, options.platform || process.platform));
  await run('manifests', () => inspectManifests(root, io));
  await run('dependencies', () => inspectDependencies(root, io));
  await run('electron', () => inspectElectron(root, io));
  await run('project-write', () => probeWritable(root, io));
  await run('temp-write', () => probeWritable(options.tempDirectory || os.tmpdir(), io));
  await run('child-process-pipe', () => probeChildProcess(process.execPath, ['-e', 'process.stdout.write("TSUKURU_DOCTOR_PIPE_OK")'], 'TSUKURU_DOCTOR_PIPE_OK', root, options.spawnSync));
  await run('git', () => probeChildProcess('git', ['rev-parse', '--is-inside-work-tree'], 'true', root, options.spawnSync));
  await run('loopback', () => probeLoopback(options.createServer, options.socketTimeoutMs));
  const names = affectingVariables.filter(name => Object.hasOwn(environment, name) && environment[name] !== undefined && environment[name] !== '');
  checks.push({ id: 'environment', ...result(names.length ? 'warning' : 'passed', names.length ? 'ENVIRONMENT_OVERRIDES' : 'NO_ENVIRONMENT_OVERRIDES',
    names.length ? 'These variable names can change application or verification behavior; values are intentionally omitted.' : 'No known behavior-changing environment overrides were found.',
    { names }, names.length ? 'Check whether these overrides are intentional before interpreting application or harness results.' : undefined) });
  return {
    schemaVersion: 1, status: checks.some(check => check.status === 'failed') ? 'failed' : checks.some(check => check.status === 'warning') ? 'warning' : 'passed',
    startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, root, checks,
    scope: 'Local prerequisites only. Passing does not establish build, application, provider, packaging, or cross-platform correctness.',
  };
}

async function main(args = process.argv.slice(2), options = {}) {
  const log = options.log || console.log;
  const logError = options.logError || console.error;
  if (args.length) {
    logError('[doctor] No arguments are supported. Run: node scripts/doctor.cjs');
    return 2;
  }
  const io = options.fs || fs;
  const report = await runDoctor(options);
  const reportPath = path.join(report.root, 'artifacts', 'doctor', 'latest.json');
  const temporaryPath = `${reportPath}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  let reportWritten = false;
  try {
    io.mkdirSync(path.dirname(reportPath), { recursive: true });
    io.writeFileSync(temporaryPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    io.renameSync(temporaryPath, reportPath);
    reportWritten = true;
  } catch (error) {
    report.status = 'failed';
    logError(`[doctor] REPORT_WRITE_FAILED (${errorCode(error)}): ${reportPath}`);
  } finally {
    try { if (io.existsSync(temporaryPath)) io.rmSync(temporaryPath, { force: true }); }
    catch (error) { report.status = 'failed'; logError(`[doctor] REPORT_CLEANUP_FAILED (${errorCode(error)}): ${temporaryPath}`); }
  }
  for (const check of report.checks) {
    log(`[doctor] ${check.status}: ${check.id} (${check.code})${check.hint ? `\n  ${check.hint}` : ''}`);
  }
  log(`[doctor] ${report.status}: ${reportWritten ? reportPath : 'report artifact was not updated'}`);
  return report.status === 'failed' ? 1 : 0;
}

module.exports = { inspectRuntime, inspectManifests, inspectDependencies, inspectElectron, probeWritable, probeChildProcess, probeLoopback, runDoctor, main };

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`[doctor] Unexpected failure (${errorCode(error)}).`);
  process.exitCode = 1;
});
