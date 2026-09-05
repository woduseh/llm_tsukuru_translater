#!/usr/bin/env node
// One local/CI verification entrypoint. Deliberately uses argv, never a shell.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const FAST = ['typecheck-main', 'typecheck-renderer', 'lint', 'unit'];

function parseArgs(args) {
  const options = { full: false, plan: false, base: undefined };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') options.full = true;
    else if (args[i] === '--plan') options.plan = true;
    else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('-')) options.base = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}. Use --plan, --full, --base <git-ref>.`);
  }
  return options;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

function changedFiles(root, base) {
  // Resolve first so a user-supplied ref never becomes a git option.
  const ref = git(root, ['rev-parse', '--verify', '--end-of-options', base || 'HEAD']).trim();
  const changed = git(root, ['diff', '--name-only', '--no-renames', '-z', ref, '--']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set((changed + untracked).split('\0').filter(Boolean))].sort();
}

function createPlan(files, options = {}) {
  const reasons = [];
  let integration = false;
  let ui = false;
  let full = !!options.full;
  const code = files.filter(file => !/\.md$/i.test(file));
  for (const file of code) {
    if (/^src\/(ts|agent|mcp)\//.test(file)) {
      integration = true;
      reasons.push(`${file}: production workflow → core/eval`);
      if (/^src\/agent\/(terminal|pty|mutationApprovalRuntime|agentBridgeServer)/.test(file)) ui = true;
    } else if (/^src\/(renderer|ipc|harness)\/|^src\/(preload|appContext)\.ts$|^main\.ts$/.test(file)) {
      integration = true;
      ui = true;
      reasons.push(`${file}: application/IPC surface → core/eval/UI`);
    } else if (/^test\/(unit|utils)\//.test(file)) {
      reasons.push(`${file}: unit suite`);
    } else {
      // Config, fixtures, scripts, types and unknown paths may affect any suite.
      full = true;
      reasons.push(`${file}: shared or unclassified input → full verification`);
    }
  }
  if (options.full) reasons.unshift('--full: all deterministic CI checks, including coverage');
  if (!full && code.length === 0) {
    return { mode: 'changed', files, reasons: [files.length ? 'Documentation-only changes; no executable checks selected.' : 'No changes; use --base <ref> for committed work or --full.'], checks: [] };
  }
  const checks = [...FAST];
  if (full || integration || ui) checks.push('clean-main', 'build-main');
  if (full || ui) checks.push('build-renderer', 'build-mcp');
  if (full || integration) checks.push('core', 'eval');
  if (full || ui) checks.push('ui');
  if (full) checks.push('package-smoke');
  return { mode: full ? 'full' : 'changed', files, reasons, checks };
}

function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  const files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  for (const file of files) {
    hash.update(file + '\0');
    try {
      const target = path.join(root, file);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(target));
      else if (stat.isFile()) hash.update(fs.readFileSync(target));
      else hash.update('non-file');
      hash.update(`\0${stat.mode}\0`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('deleted\0');
    }
  }
  return hash.digest('hex');
}

function definitions(plan, root) {
  const cli = (name) => {
    const [packageName, ...relativePath] = name.split('/');
    return path.join(path.dirname(require.resolve(`${packageName}/package.json`, { paths: [root] })), ...relativePath);
  };
  const node = (args, depends = []) => ({ command: process.execPath, args, depends });
  const harness = (name, depends) => ({ ...node([`scripts/harness/${name}.cjs`], depends), harness: true });
  return {
    'typecheck-main': node([cli('typescript/bin/tsc'), '-p', 'tsconfig.main.json', '--noEmit']),
    'typecheck-renderer': node([cli('vue-tsc/bin/vue-tsc.js'), '-p', 'tsconfig.renderer.json', '--noEmit']),
    lint: node([cli('eslint/bin/eslint.js'), 'src/**/*.ts', 'src/renderer/**/*.vue', 'main.ts']),
    unit: node([cli('vitest/vitest.mjs'), 'run', ...(plan.mode === 'full' ? ['--coverage'] : [])]),
    'clean-main': node(['scripts/clean-main.cjs']),
    'build-main': node([cli('typescript/bin/tsc'), '-p', 'tsconfig.main.json'], ['clean-main']),
    'build-renderer': node([cli('vite/bin/vite.js'), 'build', '--config', 'vite.renderer.config.ts']),
    'build-mcp': node(['scripts/build-mcp-server.mjs']),
    core: harness('core', ['build-main']),
    eval: harness('eval', ['build-main']),
    ui: harness('ui', ['build-main', 'build-renderer', 'build-mcp']),
    'package-smoke': harness('package-smoke', []),
  };
}

function executeCheck(check, { root, logPath, env }) {
  return new Promise(resolve => {
    const log = fs.openSync(logPath, 'w');
    const started = Date.now();
    let child;
    const finish = (result) => {
      fs.closeSync(log);
      resolve({ ...result, durationMs: Date.now() - started });
    };
    try {
      child = spawn(check.command, check.args, { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log], shell: false });
    } catch (error) {
      finish({ status: 'failed', error: { message: error.message, code: error.code } });
      return;
    }
    let spawnError;
    child.on('error', error => { spawnError = error; });
    child.on('close', (exitCode, signal) => finish({
      status: !spawnError && exitCode === 0 ? 'passed' : 'failed', exitCode, signal,
      ...(spawnError ? { error: { message: spawnError.message, code: spawnError.code } } : {}),
    }));
  });
}

function writeReport(file, report) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(temp, file);
}

async function runPlan(plan, options = {}) {
  const root = options.root || projectRoot;
  const execute = options.execute || executeCheck;
  const fingerprint = options.fingerprint || (() => sourceFingerprint(root));
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const outputDir = path.join(root, 'artifacts', 'verify', id);
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'result.json');
  const latestPath = path.join(root, 'artifacts', 'verify', 'latest.json');
  const report = { schemaVersion: 1, id, status: 'running', startedAt: new Date().toISOString(), node: process.version, ...plan, checks: [], sourceFingerprint: fingerprint(), reportPath };
  const save = () => { writeReport(reportPath, report); writeReport(latestPath, report); };
  save();
  // Always validate this checkout; inherited opt-ins must not switch to a live
  // provider, packaged executable, or reuse old compiled output.
  const env = { ...process.env };
  for (const key of ['LLM_TSUKURU_SKIP_BUILD', 'LLM_TSUKURU_UI_HARNESS_EXECUTABLE', 'LLM_TSUKURU_PACKAGE_SMOKE']) delete env[key];
  try {
    const specs = options.definitions || (plan.checks.length ? definitions(plan, root) : {});
    for (const name of plan.checks) {
      const spec = specs[name];
      if (!spec) throw new Error(`Missing check definition: ${name}`);
      const blockedBy = (spec.depends || []).filter(dep => report.checks.find(check => check.id === dep)?.status !== 'passed');
      const logPath = path.join(outputDir, `${name}.log`);
      const args = [...spec.args];
      const artifact = spec.harness ? path.join(outputDir, `${name}.json`) : undefined;
      if (artifact) args.push('--output', artifact);
      const record = { id: name, command: spec.command, args, logPath, artifact, status: 'running' };
      report.checks.push(record);
      if (blockedBy.length) {
        Object.assign(record, { status: 'blocked', blockedBy });
      } else {
        save();
        console.log(`[verify] ${name} ...`);
        let result;
        try {
          result = await execute({ ...spec, args }, { root, logPath, env: { ...env, ...(spec.harness ? { LLM_TSUKURU_SKIP_BUILD: '1' } : {}) } });
        } catch (error) {
          result = { status: 'failed', error: { message: error.message, code: error.code } };
        }
        Object.assign(record, result);
        if (artifact && result.status === 'passed') {
          try {
            const evidence = JSON.parse(fs.readFileSync(artifact, 'utf8'));
            const allowedStatuses = name === 'package-smoke' ? ['passed', 'skipped'] : ['passed'];
            if (evidence.schemaVersion !== 1 || evidence.suite !== `harness-${name}`
              || !allowedStatuses.includes(evidence.status) || evidence.fatal || evidence.failed > 0
              || !Array.isArray(evidence.cases) || evidence.cases.length === 0
              || evidence.cases.some(c => !['passed', 'skipped'].includes(c.status))) {
              throw new Error('Harness artifact is missing valid success evidence despite exit code 0');
            }
            record.harnessStatus = evidence.status;
            record.skippedCases = (evidence.cases || []).filter(c => c.status === 'skipped').map(c => c.id);
          } catch (error) { Object.assign(record, { status: 'failed', error: { message: error.message } }); }
        }
        if (record.status === 'failed') {
          record.failureHint = record.error?.code === 'EPERM'
            ? 'Child process creation was denied. Rerun with the execution permission required by this environment.'
            : `Inspect ${logPath} and rerun the recorded command/args.`;
          console.error(`[verify] ${name} failed: ${record.error?.message || `exit ${record.exitCode}`}; ${record.failureHint}`);
          if (fs.existsSync(logPath)) console.error(fs.readFileSync(logPath, 'utf8').slice(-2500));
        } else console.log(`[verify] ${name} ${record.status} (${record.durationMs}ms)`);
      }
      save();
    }
    report.finalSourceFingerprint = fingerprint();
    report.sourceChanged = report.sourceFingerprint !== report.finalSourceFingerprint;
    report.status = report.sourceChanged ? 'stale' : report.checks.some(check => ['failed', 'blocked'].includes(check.status)) ? 'failed' : report.checks.length ? 'passed' : 'skipped';
    if (report.sourceChanged) report.failureHint = 'Source changed during verification. Rerun against the final checkout; these results are stale.';
  } catch (error) {
    report.status = 'failed';
    report.error = { message: error.message, code: error.code };
  }
  report.completedAt = new Date().toISOString();
  save();
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = changedFiles(projectRoot, options.base);
  const plan = createPlan(files, options);
  plan.base = options.base || 'HEAD';
  plan.head = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (options.plan) { console.log(JSON.stringify(plan, null, 2)); return; }
  console.log(`[verify] ${plan.mode}: ${files.length} changed files, ${plan.checks.length} checks`);
  const result = await runPlan(plan);
  console.log(`[verify] ${result.status}: ${result.reportPath}`);
  if (!result.checks.length) console.log(plan.reasons.join('\n'));
  if (result.failureHint) console.error(result.failureHint);
  process.exitCode = ['passed', 'skipped'].includes(result.status) ? 0 : 1;
}

module.exports = { parseArgs, changedFiles, createPlan, sourceFingerprint, definitions, executeCheck, runPlan };
if (require.main === module) main().catch(error => { console.error(`[verify] ${error.stack || error}`); process.exitCode = 1; });
