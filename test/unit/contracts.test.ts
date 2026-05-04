import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import {
  LLM_PROVIDER_METADATA,
  LLM_PROVIDER_SECRET_SETTING_KEYS,
} from '../../src/types/llmProviderContract';
import {
  RECEIVE_CHANNELS,
  SEND_CHANNELS,
  isReceiveChannel,
  isSendChannel,
} from '../../src/types/ipc';
import type { HarnessSuiteResult } from '../../src/types/harness';

const require = createRequire(import.meta.url);
const harnessShared = require('../../scripts/harness/_shared.cjs') as {
  runCases: (suiteName: string, cases: Array<{ id: string; title: string; run: () => unknown }>) => Promise<HarnessSuiteResult>;
  normalizeHarnessResult: (suiteName: string, result: Partial<HarnessSuiteResult>, outputPath: string) => HarnessSuiteResult;
};

describe('IPC channel contract', () => {
  it('keeps channel allowlists stable and type-guarded for preload and renderer agents', () => {
    expect(SEND_CHANNELS).toContain('llmSettingsApply');
    expect(SEND_CHANNELS).toContain('verifyReady');
    expect(RECEIVE_CHANNELS).toContain('llmSettings');
    expect(RECEIVE_CHANNELS).toContain('verifyLlmRepairDone');

    expect(isSendChannel('openLLMCompare')).toBe(true);
    expect(isSendChannel('unknown-channel')).toBe(false);
    expect(isReceiveChannel('initCompare')).toBe(true);
    expect(isReceiveChannel('unknown-channel')).toBe(false);
  });
});

describe('LLM provider metadata contract', () => {
  it('declares current provider identities, required fields, secrets, and cache inputs', () => {
    expect(Object.keys(LLM_PROVIDER_METADATA).sort()).toEqual(['claude', 'custom-openai', 'gemini', 'openai', 'vertex']);
    expect(LLM_PROVIDER_METADATA.gemini.displayName).toBe('Gemini API');
    expect(LLM_PROVIDER_METADATA.vertex.displayName).toBe('Vertex AI');
    expect(LLM_PROVIDER_METADATA.openai.displayName).toBe('OpenAI');
    expect(LLM_PROVIDER_METADATA['custom-openai'].displayName).toBe('OpenAI 호환 API');
    expect(LLM_PROVIDER_METADATA.claude.displayName).toBe('Claude');
    expect(LLM_PROVIDER_METADATA.gemini.settingFields.some((field) => field.key === 'llmApiKey' && field.secret)).toBe(true);
    expect(LLM_PROVIDER_METADATA.vertex.settingFields.some((field) => field.key === 'llmVertexServiceAccountJson' && field.secret)).toBe(true);
    expect(LLM_PROVIDER_METADATA.openai.settingFields.some((field) => field.key === 'llmOpenAiApiKey' && field.secret)).toBe(true);
    expect(LLM_PROVIDER_METADATA['custom-openai'].settingFields.some((field) => field.key === 'llmCustomApiKey' && field.secret)).toBe(true);
    expect(LLM_PROVIDER_METADATA.claude.settingFields.some((field) => field.key === 'llmClaudeApiKey' && field.secret)).toBe(true);
    expect(LLM_PROVIDER_METADATA.vertex.cacheKeyParts).toContain('llmVertexLocation');
    expect(LLM_PROVIDER_METADATA['custom-openai'].cacheKeyParts).toContain('llmCustomBaseUrl');
    expect(LLM_PROVIDER_SECRET_SETTING_KEYS).toEqual([
      'llmApiKey',
      'llmVertexServiceAccountJson',
      'llmOpenAiApiKey',
      'llmCustomApiKey',
      'llmClaudeApiKey',
    ]);
  });
});

describe('harness result contract', () => {
  it('accepts deterministic suite results and opt-in live skipped results', () => {
    const deterministicResult: HarnessSuiteResult = {
      schemaVersion: 1,
      suite: 'harness-core',
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
      cases: [{
        id: 'contract-case',
        title: 'contract case',
        status: 'passed',
        durationMs: 1,
        details: { stable: true },
      }],
      metrics: { stable: true },
      artifacts: { result: 'artifacts/harness/harness-core.json' },
      reproCommand: 'npm run harness:core',
      failureHints: [],
    };
    const liveSkippedResult: HarnessSuiteResult = {
      schemaVersion: 1,
      suite: 'harness-live',
      status: 'skipped',
      cases: [],
      provider: 'gemini',
      reason: 'required live-provider credentials or model were not supplied',
      metrics: { credentialsPresent: false },
      artifacts: { result: 'artifacts/harness/harness-live.json' },
      reproCommand: 'npm run harness:live',
      failureHints: ['Set credentials to run live harness.'],
    };

    expect(deterministicResult.status).toBe('passed');
    expect(liveSkippedResult.status).toBe('skipped');
  });

  it('normalizes shared harness output with agent-facing fields and failure hints', async () => {
    const result = await harnessShared.runCases('harness-contract', [{
      id: 'intentional-failure',
      title: 'intentional failure',
      run: () => {
        throw new Error('contract failure');
      },
    }]);
    const normalized = harnessShared.normalizeHarnessResult(
      'harness-contract',
      result,
      path.join(process.cwd(), 'artifacts', 'harness', 'harness-contract.json'),
    );

    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.cases[0].status).toBe('failed');
    expect(normalized.metrics).toEqual({});
    expect(normalized.artifacts?.result).toBe('artifacts/harness/harness-contract.json');
    expect(normalized.reproCommand).toContain('contract.cjs');
    expect(normalized.failureHints?.some((hint) => hint.includes('intentional-failure'))).toBe(true);
  });
});
