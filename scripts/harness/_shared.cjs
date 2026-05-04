const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const HARNESS_RESULT_SCHEMA_VERSION = 1;

const DEFAULT_REPRO_COMMANDS = {
  'harness-core': 'npm run harness:core',
  'harness-eval': 'npm run harness:eval',
  'harness-ui': 'npm run harness:ui',
  'harness-live': 'npm run harness:live',
};

function npmCommand() {
  return 'npm';
}

function runCommand(command, args, options = {}) {
  const spawnOptions = {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  };
  const result = process.platform === 'win32'
    ? spawnSync([command, ...args].join(' '), { ...spawnOptions, shell: true })
    : spawnSync(command, args, spawnOptions);

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
  const workspaceRoot = path.join(projectRoot, 'artifacts', 'harness', 'workspaces');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return fs.mkdtempSync(path.join(workspaceRoot, prefix));
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

function relativeArtifactPath(filePath) {
  return path.relative(projectRoot, filePath).replaceAll(path.sep, '/');
}

function reproCommandForSuite(suiteName) {
  const command = DEFAULT_REPRO_COMMANDS[suiteName] || `node scripts/harness/${suiteName.replace(/^harness-/, '')}.cjs`;
  const outputFlagIndex = process.argv.indexOf('--output');
  if (outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]) {
    return `${command} -- --output ${process.argv[outputFlagIndex + 1]}`;
  }
  return command;
}

function buildFailureHints(result) {
  if (result.status === 'passed' || result.status === 'skipped') return [];

  const hints = [];
  const failedCases = (result.cases || result.results || []).filter((testCase) => testCase.status === 'failed');
  for (const testCase of failedCases.slice(0, 5)) {
    const message = testCase.error?.message ? `: ${testCase.error.message}` : '';
    hints.push(`Inspect case ${testCase.id}${message}`);
  }

  if (result.fatal && result.error?.message) {
    hints.push(`Fatal setup failure: ${result.error.message}`);
  }

  if (result.suite === 'harness-live') {
    hints.push('Live-provider checks are opt-in; verify credentials and LLM_HARNESS_MODEL before rerunning.');
  } else {
    hints.push(`Rerun ${result.reproCommand || reproCommandForSuite(result.suite)} for a fresh deterministic artifact.`);
  }

  return hints;
}

function normalizeHarnessResult(suiteName, result, outputPath) {
  const cases = result.cases || result.results || [];
  const completedAt = result.completedAt || new Date().toISOString();
  const total = result.total ?? cases.length;
  const passed = result.passed ?? cases.filter((testCase) => testCase.status === 'passed').length;
  const failed = result.failed ?? cases.filter((testCase) => testCase.status === 'failed').length;
  const status = result.status || (failed === 0 ? 'passed' : 'failed');
  const artifacts = {
    ...(result.artifacts || {}),
    result: relativeArtifactPath(outputPath),
  };
  const normalized = {
    schemaVersion: HARNESS_RESULT_SCHEMA_VERSION,
    ...result,
    suite: suiteName,
    status,
    completedAt,
    total,
    passed,
    failed,
    cases,
    results: result.results || cases,
    metrics: result.metrics || {},
    artifacts,
    reproCommand: result.reproCommand || reproCommandForSuite(suiteName),
  };
  normalized.failureHints = result.failureHints || buildFailureHints(normalized);
  return normalized;
}

function writeHarnessResult(defaultName, result) {
  const outputPath = resolveOutputPath(defaultName);
  const suiteName = result.suite || defaultName;
  const normalized = normalizeHarnessResult(suiteName, result, outputPath);
  writeJson(outputPath, normalized);
  return normalized;
}

function writeFatalHarnessResult(defaultName, error, extra = {}) {
  return writeHarnessResult(defaultName, {
    suite: defaultName,
    status: 'failed',
    fatal: true,
    error: serializeError(error),
    ...extra,
  });
}

function writeTaskManifest(suiteName, cases, metadata = {}) {
  const manifestPath = path.join(projectRoot, 'artifacts', 'harness', `${suiteName}-task-manifest.json`);
  const manifest = {
    schemaVersion: HARNESS_RESULT_SCHEMA_VERSION,
    suite: suiteName,
    deterministic: metadata.deterministic ?? suiteName !== 'harness-live',
    liveProviderRequired: metadata.liveProviderRequired ?? suiteName === 'harness-live',
    generatedAt: new Date().toISOString(),
    cases: cases.map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      category: testCase.category,
    })),
    ...metadata,
  };
  writeJson(manifestPath, manifest);
  return relativeArtifactPath(manifestPath);
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
    schemaVersion: HARNESS_RESULT_SCHEMA_VERSION,
    suite: suiteName,
    startedAt,
    completedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    status: failed === 0 ? 'passed' : 'failed',
    cases: results,
    results,
    metrics: {},
    artifacts: {},
    reproCommand: reproCommandForSuite(suiteName),
  };
}

module.exports = {
  assert,
  buildAppIfNeeded,
  buildMainIfNeeded,
  copyDir,
  deepEqual,
  defaultExport,
  HARNESS_RESULT_SCHEMA_VERSION,
  loadCompiledModule,
  makeTempDir,
  normalizeHarnessResult,
  npmCommand,
  projectRoot,
  readJson,
  relativeArtifactPath,
  resolveOutputPath,
  runCases,
  runCommand,
  serializeError,
  writeFatalHarnessResult,
  writeHarnessResult,
  writeJson,
  writeTaskManifest,
};
