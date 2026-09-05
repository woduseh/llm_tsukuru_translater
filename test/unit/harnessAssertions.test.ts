import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as translationCore from '../../src/ts/libs/translationCore';
import * as translationSyntax from '../../src/ts/libs/translationSyntax';
import * as verify from '../../src/ts/rpgmv/verify';

interface HarnessResult {
  status: string;
  failed?: number;
  cases?: Array<{ id: string; status: string }>;
}

// Execute the actual harness entrypoint while replacing builds, artifacts, and
// provider calls. This tests its pass/fail decision without compiled output or credentials.
async function runHarness(script: 'eval' | 'live', modules: Record<string, unknown> = {}) {
  const scriptPath = path.resolve('scripts/harness', `${script}.cjs`);
  const require = createRequire(scriptPath);
  const shared = require('./_shared.cjs');
  const processStub = { env: { LLM_HARNESS_MODEL: 'fixture-model' }, exitCode: 0 };
  const loadedModules: Record<string, unknown> = {
    'src/ts/libs/translationCore.js': translationCore,
    'src/ts/libs/translationSyntax.js': translationSyntax,
    'src/ts/rpgmv/verify.js': verify,
    'src/ts/libs/llmProviderConfig.js': {
      validateLlmSettings: () => ({ llmReady: true, llmValidationErrors: [] }),
    },
    ...modules,
  };
  const result = await new Promise<HarnessResult>((resolve, reject) => {
    const harnessShared = {
      ...shared,
      buildMainIfNeeded: () => {},
      writeTaskManifest: () => 'in-memory',
      writeHarnessResult: (_suite: string, value: HarnessResult) => resolve(value),
      writeFatalHarnessResult: (_suite: string, error: unknown) => reject(error),
      loadCompiledModule: (name: string) => {
        if (!(name in loadedModules)) throw new Error(`Unexpected module: ${name}`);
        return loadedModules[name];
      },
    };
    runInNewContext(readFileSync(scriptPath, 'utf8'), {
      require: (name: string) => name === './_shared.cjs' ? harnessShared : require(name),
      process: processStub,
    }, { filename: scriptPath });
  });
  return { result, exitCode: processStub.exitCode };
}

describe('harness pass/fail assertions', () => {
  it('accepts the real verifier against the complete eval corpus', async () => {
    const { result, exitCode } = await runHarness('eval');
    expect(result.status).toBe('passed');
    expect(result.failed).toBe(0);
    expect(exitCode).toBe(0);
  });

  it('rejects a verifier that reports every expected error for every input', async () => {
    const { result, exitCode } = await runHarness('eval', {
      'src/ts/rpgmv/verify.js': {
        ...verify,
        verifyJsonIntegrity: () => [
          { type: 'text_shift', path: '$.parameters[0]', severity: 'error' },
          { type: 'control_char_mismatch', path: '$', severity: 'warning' },
        ],
      },
    });
    expect(result.status).toBe('failed');
    expect(result.cases?.find(item => item.id === 'verify-accepts-valid-event-translation')?.status).toBe('failed');
    expect(exitCode).toBe(1);
  });

  it.each(['path', 'severity', 'duplicates'] as const)('rejects incorrect issue %s', async (mutation) => {
    const { result, exitCode } = await runHarness('eval', {
      'src/ts/rpgmv/verify.js': {
        ...verify,
        verifyJsonIntegrity: (...args: Parameters<typeof verify.verifyJsonIntegrity>) => {
          const issues = verify.verifyJsonIntegrity(...args);
          if (mutation === 'duplicates') return [...issues, ...issues];
          return issues.map(issue => ({ ...issue, [mutation]: mutation === 'path' ? '$.wrong' : 'info' }));
        },
      },
    });
    expect(result.status).toBe('failed');
    expect(exitCode).toBe(1);
  });

  it.each([
    ['intact structure', '--- 101 ---\n안녕하세요\\V[1]\\N[2]\n\n안녕히 가세요', 'passed'],
    ['dropped control codes', '--- 101 ---\n안녕하세요BROKEN\n\n안녕히 가세요', 'failed'],
    ['reordered control codes', '--- 101 ---\n안녕하세요\\N[2]\\V[1]\n\n안녕히 가세요', 'failed'],
    ['filled empty line', '--- 101 ---\n안녕하세요\\V[1]\\N[2]\n추가됨\n안녕히 가세요', 'failed'],
    ['moved empty line', '--- 101 ---\n안녕하세요\\V[1]\\N[2]\n안녕히 가세요\n', 'failed'],
    ['changed separator', '--- 999 ---\n안녕하세요\\V[1]\\N[2]\n\n안녕히 가세요', 'failed'],
    ['extra line', '--- 101 ---\n안녕하세요\\V[1]\\N[2]\n\n안녕히 가세요\n추가됨', 'failed'],
  ])('live harness handles %s', async (_label, translated, expectedStatus) => {
    const { result, exitCode } = await runHarness('live', {
      'src/ts/libs/translatorFactory.js': {
        createTranslator: () => ({ translateText: async () => translated }),
      },
    });
    expect(result.status).toBe(expectedStatus);
    expect(exitCode).toBe(expectedStatus === 'passed' ? 0 : 1);
  });
});
