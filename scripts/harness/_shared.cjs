const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const signalText = result.signal ? ` (signal: ${result.signal})` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${signalText}`);
  }
}

function buildMainIfNeeded() {
  if (process.env.LLM_TSUKURU_SKIP_BUILD === '1') return;
  runCommand(npmCommand(), ['run', 'build:ts']);
}

function buildAppIfNeeded() {
  if (process.env.LLM_TSUKURU_SKIP_BUILD === '1') return;
  runCommand(npmCommand(), ['run', 'prebuild']);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function resolveOutputPath(defaultName) {
  const outputFlagIndex = process.argv.indexOf('--output');
  if (outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]) {
    return path.resolve(process.cwd(), process.argv[outputFlagIndex + 1]);
  }
  return path.join(projectRoot, 'artifacts', 'harness', `${defaultName}.json`);
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadCompiledModule(relativePath) {
  return require(path.join(projectRoot, 'dist-main', relativePath));
}

function defaultExport(moduleValue) {
  return moduleValue && moduleValue.default ? moduleValue.default : moduleValue;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

async function runCases(suiteName, cases) {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const testCase of cases) {
    const caseStartedAt = Date.now();
    try {
      const details = await testCase.run();
      results.push({
        id: testCase.id,
        title: testCase.title,
        status: 'passed',
        durationMs: Date.now() - caseStartedAt,
        details,
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        title: testCase.title,
        status: 'failed',
        durationMs: Date.now() - caseStartedAt,
        error: serializeError(error),
      });
    }
  }

  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.length - passed;

  return {
    suite: suiteName,
    startedAt,
    completedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    status: failed === 0 ? 'passed' : 'failed',
    results,
  };
}

module.exports = {
  assert,
  buildAppIfNeeded,
  buildMainIfNeeded,
  copyDir,
  deepEqual,
  defaultExport,
  loadCompiledModule,
  makeTempDir,
  npmCommand,
  projectRoot,
  readJson,
  resolveOutputPath,
  runCases,
  runCommand,
  serializeError,
  writeJson,
};
