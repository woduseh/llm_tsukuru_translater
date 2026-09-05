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
      'typecheck-main', 'typecheck-renderer', 'lint', 'unit', 'clean-main', 'build-main', 'core', 'eval',
    ]);
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
  it('blocks build dependents while running unrelated checks', async () => {
    const { plan, options } = setup(['build', 'core', 'unit'], {
      build: { command: 'node', args: [] }, core: { command: 'node', args: [], depends: ['build'] }, unit: { command: 'node', args: [] },
    });
    const execute = vi.fn().mockResolvedValueOnce({ status: 'failed', exitCode: 1 }).mockResolvedValueOnce({ status: 'passed', exitCode: 0 });
    const report = await runner.runPlan(plan, { ...options, execute });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(report.checks[1]).toMatchObject({ status: 'blocked', blockedBy: ['build'] });
    expect(report.checks[2].status).toBe('passed');
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
  it('clears inherited build/packaging/executable opt-ins and grants skip-build only to harnesses', async () => {
    for (const key of ['LLM_TSUKURU_SKIP_BUILD', 'LLM_TSUKURU_UI_HARNESS_EXECUTABLE', 'LLM_TSUKURU_PACKAGE_SMOKE']) vi.stubEnv(key, 'inherited');
    const { plan, options } = setup(['build', 'core'], {
      build: { command: 'node', args: [] }, core: { command: 'node', args: [], harness: true, depends: ['build'] },
    });
    const execute = vi.fn(async (check: { args: string[] }, context: { env: NodeJS.ProcessEnv }) => {
      expect(context.env.LLM_TSUKURU_UI_HARNESS_EXECUTABLE).toBeUndefined();
      expect(context.env.LLM_TSUKURU_PACKAGE_SMOKE).toBeUndefined();
      if (check.args.includes('--output')) {
        expect(context.env.LLM_TSUKURU_SKIP_BUILD).toBe('1');
        fs.writeFileSync(check.args.at(-1)!, JSON.stringify({ schemaVersion: 1, suite: 'harness-core', status: 'passed', cases: [{ id: 'fixture', status: 'passed' }] }));
      } else expect(context.env.LLM_TSUKURU_SKIP_BUILD).toBeUndefined();
      return { status: 'passed', exitCode: 0 };
    });
    const report = await runner.runPlan(plan, { ...options, execute });
    expect(report.status).toBe('passed');
    expect(report.checks[1].args).toEqual(['--output', report.checks[1].artifact]);
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
