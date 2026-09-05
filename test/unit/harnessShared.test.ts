import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shared = require('../../scripts/harness/_shared.cjs');
const sharedPath = path.join(process.cwd(), 'scripts/harness/_shared.cjs');

describe('harness command execution', () => {
  it('preserves spaces, quotes, Unicode and shell characters as literal arguments', () => {
    const values = ['game project', '한글 경로', 'a"b', 'a&b', '%PATH%', '$HOME'];
    expect(() => shared.runCommand(process.execPath, [
      '-e',
      'require("node:assert/strict").deepEqual(process.argv.slice(1), JSON.parse(process.env.HARNESS_TEST_ARGS))',
      ...values,
    ], { stdio: 'pipe', env: { ...process.env, HARNESS_TEST_ARGS: JSON.stringify(values) } })).not.toThrow();
  });

  it('records the actual process exit code and reproducible command in serialized failures', () => {
    let failure;
    try {
      shared.runCommand(process.execPath, ['-e', 'process.exit(23)'], { stdio: 'pipe' });
    } catch (error) {
      failure = shared.serializeError(error);
    }
    expect(failure).toMatchObject({
      command: process.execPath,
      args: ['-e', 'process.exit(23)'],
      exitCode: 23,
      signal: null,
      cwd: process.cwd(),
    });
  });

  it('records launch failures separately from nonzero process exits', () => {
    let failure;
    try {
      shared.runCommand('llm-tsukuru-nonexistent-test-executable', [], { stdio: 'pipe' });
    } catch (error) {
      failure = shared.serializeError(error);
    }
    expect(failure).toMatchObject({ code: 'ENOENT', exitCode: null, signal: null });
  });

  it.each([true, false])('executes Windows npm without a shell (npm environment present=%s)', (npmEnvironment) => {
    const npmPath = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const spawnSync = vi.fn(() => ({ status: 0 }));
    const module = { exports: {} as typeof shared };
    vm.runInNewContext(fs.readFileSync(sharedPath, 'utf8'), {
      __dirname: path.dirname(sharedPath), module,
      process: { platform: 'win32', execPath: process.execPath, env: npmEnvironment ? { npm_execpath: npmPath } : {} },
      require(id: string) {
        if (id === 'child_process') return { spawnSync };
        if (id === 'fs') return { existsSync: (candidate: string) => candidate === npmPath };
        return require(id);
      },
    });
    module.exports.runCommand('npm', ['run', 'build:ts']);
    expect(spawnSync).toHaveBeenCalledWith(process.execPath, [npmPath, 'run', 'build:ts'], {
      cwd: process.cwd(), stdio: 'inherit',
    });
  });
});

describe('harness result reliability', () => {
  const outputPath = path.join(process.cwd(), 'artifacts/harness/test.json');

  it('derives counters and failure status from actual cases even when summaries are stale', () => {
    const normalized = shared.normalizeHarnessResult('harness-core', {
      status: 'passed', total: 100, passed: 100, failed: 0, failureHints: [],
      cases: [{ id: 'failure', status: 'failed', error: { message: 'regression' } }],
      results: [{ id: 'stale', status: 'passed' }],
    }, outputPath);
    expect(normalized).toMatchObject({ status: 'failed', total: 1, passed: 0, failed: 1 });
    expect(normalized.results).toEqual(normalized.cases);
    expect(normalized.failureHints.join('\n')).toContain('regression');
  });

  it('forces fatal setup failures to failed without fabricating a failed test case', () => {
    expect(shared.normalizeHarnessResult('harness-core', {
      status: 'passed', fatal: true, error: { message: 'build failed' }, cases: [],
    }, outputPath)).toMatchObject({ status: 'failed', total: 0, passed: 0, failed: 0 });
  });

  it('preserves explicit opt-in skips and legacy case-free aggregate results', () => {
    expect(shared.normalizeHarnessResult('harness-live', { status: 'skipped', cases: [] }, outputPath).status)
      .toBe('skipped');
    expect(shared.normalizeHarnessResult('legacy', { total: 2, passed: 1, failed: 1 }, outputPath))
      .toMatchObject({ total: 2, passed: 1, failed: 1, status: 'failed' });
  });
});
