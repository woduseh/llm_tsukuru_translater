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

  it.each([false, true])('builds the MCP bundle only when core must supply its own build (reuse=%s)', async (reuseBuild) => {
    const runCommand = vi.fn();
    const buildMainIfNeeded = vi.fn();
    const workspaceBoundary = new Error('stop before the real MCP workspace and subprocess');
    const corePath = path.join(process.cwd(), 'scripts/harness/core.cjs');
    await new Promise<void>((resolve, reject) => {
      const harnessShared = {
        ...shared,
        runCommand,
        buildMainIfNeeded,
        loadCompiledModule: () => ({}),
        makeTempDir: () => { throw workspaceBoundary; },
        writeTaskManifest: () => 'in-memory',
        runCases: async (_suite: string, cases: Array<{ id: string; run: () => Promise<unknown> }>) => {
          const bundled = cases.find(testCase => testCase.id === 'bundled-mcp-stdio');
          if (!bundled) throw new Error('Missing real bundled MCP case');
          await expect(bundled.run()).rejects.toBe(workspaceBoundary);
          return { total: 0, failed: 0 };
        },
        writeHarnessResult: () => resolve(),
        writeFatalHarnessResult: (_suite: string, error: unknown) => reject(error),
      };
      vm.runInNewContext(fs.readFileSync(corePath, 'utf8'), {
        process: { env: reuseBuild ? { LLM_TSUKURU_SKIP_BUILD: '1' } : {}, exitCode: 0 },
        require: (id: string) => id === './_shared.cjs' ? harnessShared : require(id),
      }, { filename: corePath });
    });
    expect(buildMainIfNeeded).toHaveBeenCalledOnce();
    expect(runCommand.mock.calls).toEqual(reuseBuild ? [] : [['npm', ['run', 'build:mcp']]]);
  });

  it.each([true, false])('stops a failed first bulk run before retrying and losing its diagnostics (alert=%s)', async (emitError) => {
    const corePath = path.join(process.cwd(), 'scripts/harness/core.cjs');
    const originalCreateTranslator = () => ({});
    const originalReadiness = () => null;
    const factory = { createTranslator: originalCreateTranslator, getLlmReadinessError: originalReadiness };
    const trans = vi.fn(async (_event: unknown, _args: unknown, ctx: {
      mainWindow: { webContents: { send: (channel: string, ...args: unknown[]) => void } };
    }) => {
      if (emitError) ctx.mainWindow.webContents.send('alert', { icon: 'error', message: 'injected backup rename failure' });
    });
    await new Promise<void>((resolve, reject) => {
      const harnessShared = {
        ...shared,
        buildMainIfNeeded: () => {},
        makeTempDir: () => path.join(process.cwd(), 'in-memory-core-workspace'),
        writeTaskManifest: () => 'in-memory',
        loadCompiledModule: (name: string) => {
          if (name === 'src/ts/libs/translatorFactory.js') return factory;
          if (name === 'src/ts/rpgmv/translator.js') return { trans };
          if (name === 'src/ts/libs/projectTools.js') return { init: () => {} };
          return {};
        },
        runCases: async (_suite: string, cases: Array<{ id: string; run: () => Promise<unknown> }>) => {
          const bulk = cases.find(testCase => testCase.id === 'bulk-translation-workflow');
          if (!bulk) throw new Error('Missing real bulk translation case');
          await expect(bulk.run()).rejects.toThrow(emitError
            ? 'first run emitted an application error: [{"icon":"error","message":"injected backup rename failure"}]'
            : 'expected 2 translations on first run, got 0');
          return { total: 1, failed: 0 };
        },
        writeHarnessResult: () => resolve(),
        writeFatalHarnessResult: (_suite: string, error: unknown) => reject(error),
      };
      vm.runInNewContext(fs.readFileSync(corePath, 'utf8'), {
        Buffer,
        process: { env: { LLM_TSUKURU_SKIP_BUILD: '1' }, exitCode: 0 },
        require: (id: string) => {
          if (id === './_shared.cjs') return harnessShared;
          if (id === 'fs') return { ...fs, mkdirSync: vi.fn(), writeFileSync: vi.fn() };
          return require(id);
        },
      }, { filename: corePath });
    });
    expect(trans).toHaveBeenCalledOnce();
    expect(factory.createTranslator).toBe(originalCreateTranslator);
    expect(factory.getLlmReadinessError).toBe(originalReadiness);
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
