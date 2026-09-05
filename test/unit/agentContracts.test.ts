import { describe, expect, it } from 'vitest';
import { redactSecretLikeValues, validateFailureArtifact } from '../../src/agent/contractsValidation';
import type { FailureArtifact, JsonObject } from '../../src/types/agentWorkspace';

describe('agent contracts', () => {
  it('redacts secret-like values before they enter artifacts', () => {
    const payload: JsonObject = {
      provider: 'gemini',
      llmApiKey: 'AIza12345678901234567890',
      nested: { authorization: 'Bearer abc.def.ghi' },
      note: 'api_key=super-secret-value should not leak',
    };

    const redacted = redactSecretLikeValues(payload);

    expect(JSON.stringify(redacted.value)).not.toContain('super-secret-value');
    expect(JSON.stringify(redacted.value)).not.toContain('abc.def.ghi');
    expect(redacted.value.llmApiKey).toBe('[REDACTED]');
    expect(redacted.redactions.length).toBeGreaterThanOrEqual(2);
  });

  it('validates failure artifacts and rejects malformed ones', () => {
    const artifact: FailureArtifact = {
      schemaVersion: 1,
      failureId: 'failure-contract',
      requestId: 'request-contract',
      stage: 'quality.review_batch',
      message: 'Mock failure with token=[REDACTED]',
      retryable: true,
      createdAt: new Date().toISOString(),
      redactedDetails: { path: 'Extract\\Map001.txt' },
      handoff: {
        schemaVersion: 1,
        handoffId: 'handoff-contract',
        createdAt: new Date().toISOString(),
        summary: 'Continue with the fixture review batch.',
        completedSteps: ['project.context_snapshot', 'project.translation_inventory'],
        nextSteps: ['quality.review_batch'],
        artifacts: ['artifacts\\agent\\failure-contract.json'],
        failureId: 'failure-contract',
      },
    };

    expect(validateFailureArtifact(artifact).ok).toBe(true);
    expect(validateFailureArtifact({ ...artifact, schemaVersion: 2 }).ok).toBe(false);
  });

});
