import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runner = require('../../scripts/verify.cjs');
const roots: string[] = [];
function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify runner 한글 '));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('verification selection and arguments', () => {
  it.each([{ files: [] }, { files: ['readme.md', 'docs/HARNESS.md'] }])('skips unchanged/documentation-only inputs: $files', ({ files }) => {
    expect(runner.createPlan(files).checks).toEqual([]);
  });
  it('selects deterministic workflow checks for translation code', () => {
    expect(runner.createPlan(['src/ts/libs/translationCore.ts']).checks).toEqual([
      'tooling', 'typecheck-main', 'typecheck-renderer', 'lint', 'unit', 'clean-main', 'build-main', 'build-mcp', 'core', 'eval',
    ]);
  });
  it.each(['test/unit/test.test.ts', 'src/renderer/App.vue', 'package.json'])
  ('includes the native Node tooling regression suite for %s', (file) => {
    const plan = runner.createPlan([file]);
    expect(plan.checks).toContain('tooling');
    expect(runner.definitions(plan, process.cwd()).tooling).toMatchObject({
      command: process.execPath,
      args: ['--test', '--experimental-test-isolation=none', 'test/tooling/*.test.cjs'],
      depends: [],
    });
  });
  it.each(['src/renderer/App.vue', 'src/ipc/register.ts', 'src/preload.ts', 'main.ts', 'src/agent/terminalService.ts'])
  ('includes UI builds and harness for %s', (file) => {
    const plan = runner.createPlan([file]);
    expect(plan.mode).toBe('changed');
    expect(plan.checks).toEqual(expect.arrayContaining(['build-main', 'build-renderer', 'build-mcp', 'core', 'eval', 'ui']));
  });
  it.each(['package.json', 'scripts/verify.cjs', 'src/types/harness.ts', 'future/unknown.dat', 'docs/helper.cjs'])
  ('falls back to full checks for unclassified input %s', (file) => {
    expect(runner.createPlan([file])).toMatchObject({ mode: 'full', checks: expect.arrayContaining(['ui', 'package-smoke']) });
  });
  it('full mode overrides a documentation-only diff and enables coverage', () => {
    const plan = runner.createPlan(['readme.md'], { full: true });
    expect(plan.mode).toBe('full');
    expect(runner.definitions(plan, process.cwd()).unit.args).toContain('--coverage');
    expect(runner.definitions(runner.createPlan(['test/unit/test.test.ts']), process.cwd()).unit.args).not.toContain('--coverage');
  });
  it('accepts known options without treating a ref as a command', () => {
    expect(runner.parseArgs(['--full', '--base', 'origin/main', '--plan']))
      .toEqual({ full: true, plan: true, base: 'origin/main' });
  });
  it.each([{ args: ['--base'] }, { args: ['--base', '--full'] }, { args: ['--unknown'] }, { args: ['--base=HEAD'] }])('rejects incomplete/unknown arguments: $args', ({ args }) => {
    expect(() => runner.parseArgs(args)).toThrow('Unknown or incomplete option');
  });
});

describe('verification execution evidence', () => {
  function setup(checks: string[], definitions?: object) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = tempRoot();
    return {
      root,
      plan: { mode: 'changed', files: ['src/example.ts'], reasons: [], checks },
      options: { root, fingerprint: () => 'same-source', definitions: definitions || Object.fromEntries(checks.map(id => [id, { command: process.execPath, args: ['script with spaces.cjs', '한글&literal'], depends: [] }])) },
    };
  }
  it('continues independent checks after failures and persists structured commands and logs', async () => {
    const { root, plan, options } = setup(['first', 'second']);
    const execute = vi.fn().mockResolvedValueOnce({ status: 'failed', exitCode: 2 }).mockResolvedValueOnce({ status: 'passed', exitCode: 0 });
    const report = await runner.runPlan(plan, { ...options, execute });
    expect(report.status).toBe('failed');
    expect(report.checks.map((check: { status: string }) => check.status)).toEqual(['failed', 'passed']);
    expect(report.checks[0]).toMatchObject({ command: process.execPath, args: ['script with spaces.cjs', '한글&literal'] });
    expect(execute.mock.calls[0][1].logPath).toBe(report.checks[0].logPath);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'artifacts/verify/latest.json'), 'utf8'))).toEqual(report);
    expect(JSON.parse(fs.readFileSync(report.reportPath, 'utf8'))).toEqual(report);
  });
  it('records rejected executions as failures and continues independent checks', async () => {
    const { plan, options } = setup(['first', 'second']);
    const execute = vi.fn().mockRejectedValueOnce(new Error('cannot open log')).mockResolvedValueOnce({ status: 'passed', exitCode: 0 });
    const report = await runner.runPlan(plan, { ...options, execute });
    expect(report.status).toBe('failed');
    expect(report.checks.map((check: { status: string }) => check.status)).toEqual(['failed', 'passed']);
    expect(report.checks[0].error.message).toContain('cannot open log');
  });
  it.each(['build-main', 'build-mcp'])('blocks core after %s fails while running independent checks', async (failedBuild) => {
    const { plan, options } = setup(['clean-main', 'build-main', 'build-mcp', 'core', 'eval', 'unit']);
    const definitions = runner.definitions(plan, process.cwd());
    const execute = vi.fn(async (check: { args: string[] }) => {
      if (check.args[0] === definitions[failedBuild].args[0]) return { status: 'failed', exitCode: 1 };
      if (check.args.includes('--output')) fs.writeFileSync(check.args.at(-1)!, JSON.stringify({
        schemaVersion: 1, suite: 'harness-eval', status: 'passed', cases: [{ id: 'fixture', status: 'passed' }],
      }));
      return { status: 'passed', exitCode: 0 };
    });
    const report = await runner.runPlan(plan, { ...options, definitions, execute });
    expect(report.checks.find((check: { id: string }) => check.id === 'core'))
      .toMatchObject({ status: 'blocked', blockedBy: [failedBuild] });
    expect(report.checks.find((check: { id: string }) => check.id === 'eval').status)
      .toBe(failedBuild === 'build-main' ? 'blocked' : 'passed');
    expect(report.checks.find((check: { id: string }) => check.id === 'unit').status).toBe('passed');
    expect(execute).toHaveBeenCalledTimes(failedBuild === 'build-main' ? 4 : 5);
  });
  it('marks successful checks stale when source changes during verification', async () => {
    const { plan, options } = setup(['unit']);
    const report = await runner.runPlan(plan, { ...options, fingerprint: vi.fn().mockReturnValueOnce('before').mockReturnValueOnce('after'), execute: vi.fn().mockResolvedValue({ status: 'passed' }) });
    expect(report).toMatchObject({ status: 'stale', sourceChanged: true, sourceFingerprint: 'before', finalSourceFingerprint: 'after' });
  });
  it.each([
    undefined,
    { status: 'failed' },
    { fatal: true },
    { failed: 1 },
    { cases: [{ status: 'failed' }] },
    { schemaVersion: 999 },
    { suite: 'harness-eval' },
    { cases: [] },
    { cases: [{ status: 'running' }] },
    { cases: [{ id: 'not-executed', status: 'skipped' }] },
    { cases: [{ id: 'executed', status: 'passed' }, { id: 'not-executed', status: 'skipped' }] },
    { cases: [null] },
    { status: 'skipped' },
  ])
  ('rejects exit-zero harness results with missing or failed evidence: %j', async (evidence) => {
    const { plan, options } = setup(['core'], { core: { command: 'node', args: ['scripts/harness/core.cjs'], harness: true } });
    const report = await runner.runPlan(plan, { ...options, execute: async (check: { args: string[] }) => {
      if (evidence) fs.writeFileSync(check.args.at(-1)!, JSON.stringify({
        schemaVersion: 1, suite: 'harness-core', status: 'passed',
        cases: [{ id: 'fixture', status: 'passed' }], ...evidence,
      }));
      return { status: 'passed', exitCode: 0 };
    } });
    expect(report.status).toBe('failed');
    expect(report.checks[0].status).toBe('failed');
  });
  it.each([
    { cases: [{ id: 'config', status: 'passed' }, { id: 'native', status: 'skipped' }], expected: 'passed' },
    { cases: [{ id: 'config', status: 'skipped' }, { id: 'native', status: 'skipped' }], expected: 'failed' },
  ])('allows package opt-in skips only with executed success evidence: $expected', async ({ cases, expected }) => {
    const { plan, options } = setup(['package-smoke'], {
      'package-smoke': { command: 'node', args: ['scripts/harness/package-smoke.cjs'], harness: true },
    });
    const report = await runner.runPlan(plan, { ...options, execute: async (check: { args: string[] }) => {
      fs.writeFileSync(check.args.at(-1)!, JSON.stringify({
        schemaVersion: 1, suite: 'harness-package-smoke', status: 'skipped', cases,
      }));
      return { status: 'passed', exitCode: 0 };
    } });
    expect(report.status).toBe(expected);
    if (expected === 'passed') expect(report.checks[0]).toMatchObject({ harnessStatus: 'skipped', skippedCases: ['native'] });
  });
  it('clears inherited build/packaging/executable/dev-server opt-ins and grants skip-build only to harnesses', async () => {
    const clearedKeys = ['LLM_TSUKURU_SKIP_BUILD', 'LLM_TSUKURU_UI_HARNESS_EXECUTABLE', 'LLM_TSUKURU_PACKAGE_SMOKE', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE'];
    for (const key of clearedKeys) vi.stubEnv(key, 'inherited');
    const { plan, options } = setup(['build', 'core'], {
      build: { command: 'node', args: [] }, core: { command: 'node', args: [], harness: true, depends: ['build'] },
    });
    const execute = vi.fn(async (check: { args: string[] }, context: { env: NodeJS.ProcessEnv }) => {
      expect(context.env.LLM_TSUKURU_UI_HARNESS_EXECUTABLE).toBeUndefined();
      expect(context.env.LLM_TSUKURU_PACKAGE_SMOKE).toBeUndefined();
      expect(context.env.VITE_DEV_SERVER_URL).toBeUndefined();
      expect(context.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      if (check.args.includes('--output')) {
        expect(context.env.LLM_TSUKURU_SKIP_BUILD).toBe('1');
        fs.writeFileSync(check.args.at(-1)!, JSON.stringify({ schemaVersion: 1, suite: 'harness-core', status: 'passed', cases: [{ id: 'fixture', status: 'passed' }] }));
      } else expect(context.env.LLM_TSUKURU_SKIP_BUILD).toBeUndefined();
      return { status: 'passed', exitCode: 0 };
    });
    const report = await runner.runPlan(plan, { ...options, execute });
    expect(report.status).toBe('passed');
    expect(report.checks[1].args).toEqual(['--output', report.checks[1].artifact]);
    for (const key of clearedKeys) expect(process.env[key]).toBe('inherited');
  });
  it('captures real subprocess output and argv without shell interpretation', async () => {
    const root = tempRoot();
    const logPath = path.join(root, 'node.log');
    const result = await runner.executeCheck({ command: process.execPath, args: ['-e', 'console.log(process.argv[1]); console.error("stderr evidence")', '한글 path & %PATH%'] }, { root, logPath, env: process.env });
    expect(result).toMatchObject({ status: 'passed', exitCode: 0, signal: null });
    expect(fs.readFileSync(logPath, 'utf8')).toContain('한글 path & %PATH%');
    expect(fs.readFileSync(logPath, 'utf8')).toContain('stderr evidence');
  });
});

describe('verification preparation evidence', () => {
  function previousSuccess() {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = tempRoot();
    const outputDir = path.join(root, 'artifacts/verify');
    const latestPath = path.join(outputDir, 'latest.json');
    fs.mkdirSync(outputDir, { recursive: true });
    const previous = JSON.stringify({ status: 'passed', id: 'previous-run' });
    fs.writeFileSync(latestPath, previous);
    return { root, outputDir, latestPath, previous };
  }

  it.each([
    { args: ['--full'], code: 'EPERM', message: 'spawnSync git EPERM' },
    { args: ['--base', 'missing-ref'], code: undefined, message: 'fatal: Needed a single revision' },
  ])('replaces previous success when Git preparation fails: $message', async ({ args, code, message }) => {
    const { root, latestPath } = previousSuccess();
    const error = Object.assign(new Error(message), { code });
    const result = await runner.main(args, { root, changedFiles: () => { throw error; } });
    expect(result).toMatchObject({ exitCode: 1, report: {
      status: 'failed', checks: [], error: { message, phase: 'git-changes' },
    } });
    expect(result.report.id).not.toBe('previous-run');
    expect(result.report.error.code).toBe(code);
    expect(result.report.failureHint).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(latestPath, 'utf8'))).toEqual(result.report);
    expect(JSON.parse(fs.readFileSync(result.report.reportPath, 'utf8'))).toEqual(result.report);
  });

  it('persists an initial source-fingerprint failure before executing any checks', async () => {
    const { root, latestPath } = previousSuccess();
    const execute = vi.fn();
    const report = await runner.runPlan({ mode: 'changed', files: [], reasons: [], checks: ['unit'] }, {
      root, execute,
      fingerprint: () => { throw Object.assign(new Error('fingerprint Git denied'), { code: 'EPERM' }); },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(report).toMatchObject({ status: 'failed', checks: [], error: { code: 'EPERM', phase: 'source-fingerprint' } });
    expect(report).not.toHaveProperty('sourceFingerprint');
    expect(JSON.parse(fs.readFileSync(latestPath, 'utf8'))).toEqual(report);
  });

  it.each([false, true])('keeps --plan artifact-free even when preparation fails: $0', async (fail) => {
    const { root, outputDir, latestPath, previous } = previousSuccess();
    const prepare = () => {
      if (fail) throw Object.assign(new Error('plan Git denied'), { code: 'EPERM' });
      return ['src/ts/libs/translationCore.ts'];
    };
    const execution = runner.main(['--plan'], { root, changedFiles: prepare, readHead: () => 'current-head' });
    if (fail) await expect(execution).rejects.toThrow('plan Git denied');
    else expect(await execution).toMatchObject({ exitCode: 0, plan: { head: 'current-head' } });
    expect(fs.readFileSync(latestPath, 'utf8')).toBe(previous);
    expect(fs.readdirSync(outputDir)).toEqual(['latest.json']);
  });

  it('propagates report-write failures for the CLI stderr and nonzero-exit handler', async () => {
    const { root, latestPath, previous } = previousSuccess();
    const denied = Object.assign(new Error('report writes denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw denied; });
    await expect(runner.main([], {
      root, changedFiles: () => { throw new Error('Git preparation failed'); },
    })).rejects.toBe(denied);
    expect(fs.readFileSync(latestPath, 'utf8')).toBe(previous);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Git preparation failed'));
  });
});

describe('Git change detection', () => {
  it('includes staged, unstaged, untracked, deleted and base-relative committed files without path quoting loss', () => {
    const root = tempRoot();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    git('init', '-q');
    git('config', 'user.name', 'Verification Test');
    git('config', 'user.email', 'verify@example.invalid');
    for (const name of ['staged.ts', 'unstaged.ts', 'deleted.ts', 'committed.ts']) fs.writeFileSync(path.join(root, name), 'original');
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'initial');
    const base = git('rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(root, 'committed.ts'), 'committed change');
    git('add', 'committed.ts');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'second');
    fs.writeFileSync(path.join(root, 'staged.ts'), 'staged change');
    git('add', 'staged.ts');
    fs.writeFileSync(path.join(root, 'unstaged.ts'), 'unstaged change');
    fs.unlinkSync(path.join(root, 'deleted.ts'));
    fs.writeFileSync(path.join(root, '한글 untracked.ts'), 'new');
    const current = ['deleted.ts', 'staged.ts', 'unstaged.ts', '한글 untracked.ts'].sort();
    expect(runner.changedFiles(root)).toEqual(current);
    expect(runner.changedFiles(root, base)).toEqual([...current, 'committed.ts'].sort());
    const before = runner.sourceFingerprint(root);
    fs.writeFileSync(path.join(root, 'unstaged.ts'), 'changed again');
    expect(runner.sourceFingerprint(root)).not.toBe(before);
  });
});
