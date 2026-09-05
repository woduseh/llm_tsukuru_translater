import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { AppContext } from '../../src/appContext';
import { TerminalService } from '../../src/agent/terminalService';
import type { NativePtyAdapter } from '../../src/agent/ptyAdapter';

const projectRoot = process.cwd();
const nodeRequire = createRequire(path.join(projectRoot, 'package.json'));
const missingNativeModule = 'Injected missing node-pty native binary';

describe('package harness native PTY checks', () => {
  it.each([true, false])('reports only the observed native load result (available=%s)', (available) => {
    const writeHarnessResult = vi.fn();
    const writeFatalHarnessResult = vi.fn();
    const harnessProcess = { env: {}, exitCode: 0 };
    vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'scripts/harness/package-smoke.cjs'), 'utf8'), {
      process: harnessProcess,
      require(id: string) {
        if (id === './_shared.cjs') return { projectRoot, writeHarnessResult, writeFatalHarnessResult };
        if (id === 'node-pty') {
          if (!available) throw new Error(missingNativeModule);
          return {};
        }
        return nodeRequire(id);
      },
    });

    expect(writeFatalHarnessResult).not.toHaveBeenCalled();
    expect(writeHarnessResult).toHaveBeenCalledOnce();
    const result = writeHarnessResult.mock.calls[0][1];
    expect(result.cases.find((entry: { id: string }) => entry.id === 'native-pty-load')).toMatchObject({
      status: available ? 'passed' : 'skipped',
      details: { nativePtyLoad: { ok: available, error: available ? '' : missingNativeModule } },
    });
    expect(result.cases.some((entry: { id: string }) => entry.id.includes('fallback'))).toBe(false);
    expect(harnessProcess.exitCode).toBe(0);
  });

  it('keeps the actual terminal service usable with external-terminal guidance when native loading fails', () => {
    // Execute the production adapter with a failed CommonJS native import, without
    // depending on this machine's ABI or replacing its availability logic with a fake.
    const source = fs.readFileSync(path.join(projectRoot, 'src/agent/ptyAdapter.ts'), 'utf8');
    const adapterExports = {} as { NativePtyAdapter: typeof NativePtyAdapter };
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports: adapterExports,
      require(id: string) {
        if (id === 'node-pty') throw new Error(missingNativeModule);
        throw new Error(`Unexpected adapter dependency: ${id}`);
      },
    });

    const adapter = new adapterExports.NativePtyAdapter();
    const service = new TerminalService(new AppContext(), { ptyAdapter: adapter });
    expect(adapter.isAvailable()).toBe(false);
    expect(service.getCapability()).toMatchObject({
      status: 'degraded',
      nativePtyAvailable: false,
      reason: missingNativeModule,
      fallbackHint: expect.stringContaining('외부 터미널'),
    });
    expect(service.create({ schemaVersion: 1, requestId: 'missing-native', kind: 'shell' })).toMatchObject({
      ok: false,
      errorCode: 'terminal-unavailable',
      capability: { status: 'degraded', reason: missingNativeModule },
    });
    expect(service.list().sessions).toEqual([]);
  });
});
