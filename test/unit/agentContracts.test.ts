import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MockMcpClient, MockMcpServer } from '../../src/agent/mockMcp';
import { runGoldenWorkflow } from '../../src/agent/mockAgents';
import { SandboxManager, SandboxPathError, SandboxReadLimitError } from '../../src/agent/sandboxManager';
import {
  redactSecretLikeValues,
  validateAgentResultEnvelope,
  validateFailureArtifact,
  validateGoldenWorkflowTranscript,
  validateSandboxManifest,
} from '../../src/agent/contractsValidation';
import type { FailureArtifact, JsonObject } from '../../src/types/agentWorkspace';
import { generateAgentFixtureProject } from '../utils/agentFixtureProject';

const sandboxRoot = path.resolve('artifacts', 'unit', 'agentContracts');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('agent workspace contract validation scaffold', () => {
  it('validates mock MCP read-only result envelopes', () => {
    const server = new MockMcpServer();
    const client = new MockMcpClient(server);

    expect(client.listTools().map((tool) => tool.name)).toEqual([
      'project.context_snapshot',
      'project.translation_inventory',
      'quality.review_batch',
    ]);

    const result = client.callTool('project.context_snapshot', { projectId: 'fixture' });

    expect(result.status).toBe('ok');
    expect(result.permissionTier).toBe('readonly');
    expect(validateAgentResultEnvelope(result).errors).toEqual([]);
  });

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

  it('runs the golden context/inventory/review workflow through placeholder MCP tools', () => {
    const { transcript, results } = runGoldenWorkflow();

    expect(results).toHaveLength(3);
    expect(transcript.steps.map((step) => step.toolName)).toEqual([
      'project.context_snapshot',
      'project.translation_inventory',
      'quality.review_batch',
    ]);
    expect(transcript.finalStatus).toBe('ok');
    expect(validateGoldenWorkflowTranscript(transcript).errors).toEqual([]);
    for (const result of results) {
      expect(validateAgentResultEnvelope(result).ok).toBe(true);
    }
  });
});

describe('fixture project generator scaffold', () => {
  it('generates RPG Maker-like fixtures with separators, empty lines, control codes, shifted lines, and manifest', () => {
    const root = makeDir('fixture-source');
    const fixture = generateAgentFixtureProject(root);

    const text = fs.readFileSync(path.join(fixture.extractDir, 'Map001.txt'), 'utf-8');
    const shifted = fs.readFileSync(path.join(fixture.extractDir, 'Map001.shifted.txt'), 'utf-8');

    expect(text).toContain('--- 101 ---');
    expect(text).toContain('Hello \\V[1]');
    expect(text.split('\n')).toContain('');
    expect(shifted).toContain('unexpected inserted line');
    expect(JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf-8')).includes).toContain('shifted-lines');
  });
});

describe('sandbox manager scaffold', () => {
  it('copies projects, captures manifests, and rejects path traversal outside allowed roots', () => {
    const source = makeFixtureSource();
    const manager = SandboxManager.create({ sourceRoot: source, sandboxRoot: makeDir('sandbox-parent') });

    try {
      expect(manager.readTextFile('Extract\\Map001.txt')).toContain('--- 101 ---');
      expect(() => manager.resolveInsideAllowedRoot('..\\..\\outside.txt')).toThrow(SandboxPathError);
      const postManifest = manager.capturePostManifest();
      expect(validateSandboxManifest(postManifest).ok).toBe(true);
      expect(postManifest.preManifest.some((entry) => entry.relativePath.endsWith('Map001.txt'))).toBe(true);
      expect(postManifest.postManifest?.length).toBe(postManifest.preManifest.length);
    } finally {
      manager.dispose();
    }
  });

  it('rejects oversized reads before returning file contents', () => {
    const source = makeFixtureSource();
    const manager = SandboxManager.create({ sourceRoot: source, sandboxRoot: makeDir('oversized-parent'), maxReadBytes: 8 });

    try {
      expect(() => manager.readTextFile('Extract\\Map001.txt')).toThrow(SandboxReadLimitError);
    } finally {
      manager.dispose();
    }
  });
});

function makeFixtureSource(): string {
  const root = makeDir('source-project');
  generateAgentFixtureProject(root);
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
