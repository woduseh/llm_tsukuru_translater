import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  AgentSafeFileSystem,
  AgentService,
  SandboxPathError,
} from '../../src/agent';
import {
  redactSecretLikeValues,
  validateAgentResultEnvelope,
  validateGoldenWorkflowTranscript,
  validateTerminalEvent,
} from '../../src/agent/contractsValidation';
import { runGoldenWorkflow } from '../../src/agent/mockAgents';
import {
  ProtocolLightMcpClient,
  ProtocolLightMcpServer,
  createMcpMutationToolRegistry,
  createMcpReadonlyToolRegistry,
} from '../../src/mcp';
import { applyTerminalEvent, createAgentTerminalDrawerState, createMockTerminalEvent } from '../../src/renderer/agentWorkspaceModel';
import type { FailureArtifact, JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'securityHarnessGates');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('security harness gates', () => {
  it('records a deterministic mock-agent golden transcript with valid result envelopes', () => {
    const { transcript, results } = runGoldenWorkflow();

    expect(transcript).toMatchObject({
      schemaVersion: 1,
      workflowId: 'golden-project-context-inventory-review',
      finalStatus: 'ok',
      artifacts: [
        'mock://project.context_snapshot',
        'mock://project.translation_inventory',
        'mock://quality.review_batch',
      ],
    });
    expect(transcript.steps).toEqual([
      expect.objectContaining({ toolName: 'project.context_snapshot', status: 'ok', permissionTier: 'readonly' }),
      expect.objectContaining({ toolName: 'project.translation_inventory', status: 'ok', permissionTier: 'readonly' }),
      expect.objectContaining({ toolName: 'quality.review_batch', status: 'ok', permissionTier: 'readonly' }),
    ]);
    expect(validateGoldenWorkflowTranscript(transcript).ok).toBe(true);
    expect(results.every((result) => validateAgentResultEnvelope(result).ok)).toBe(true);
  });

  it('rejects traversal, ADS, UNC/absolute escapes, and symlink escapes without leaking contents', () => {
    const projectRoot = makeProject('safe-paths');
    const outside = makeDir('outside');
    const outsideSecret = path.join(outside, 'secret.txt');
    fs.writeFileSync(outsideSecret, 'token=outside-secret', 'utf-8');
    const safeFs = new AgentSafeFileSystem({ projectRoot });

    expect(() => safeFs.readText('..\\outside\\secret.txt')).toThrow(SandboxPathError);
    expect(() => safeFs.readText('Extract\\Map001.txt:Zone.Identifier')).toThrow(SandboxPathError);
    expect(() => safeFs.readText(outsideSecret)).toThrow(SandboxPathError);

    if (process.platform === 'win32') {
      expect(() => safeFs.readText('\\\\server\\share\\secret.txt')).toThrow(SandboxPathError);
    }

    const linkPath = path.join(projectRoot, 'Extract', 'linked-secret.txt');
    try {
      fs.symlinkSync(outsideSecret, linkPath, 'file');
      expect(() => safeFs.readText('Extract\\linked-secret.txt')).toThrow(SandboxPathError);
    } catch (error) {
      expect(['EPERM', 'EACCES', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')).toBe(true);
    }
  });

  it('handles malformed MCP requests, unknown tools, and invalid args as structured failures', () => {
    const service = new AgentService({ projectRoot: makeProject('mcp-negative') });
    const server = new ProtocolLightMcpServer(createMcpReadonlyToolRegistry(service));
    const client = new ProtocolLightMcpClient(server);

    expect(server.handle({} as never).error).toMatchObject({ code: -32600 });
    expect(server.handle({ jsonrpc: '2.0', id: 'bad-call', method: 'tools/call', params: { name: 7 } as never }).error)
      .toMatchObject({ code: -32602 });
    expect(server.handle({ jsonrpc: '2.0', id: 'bad-method', method: 'resources/list' }).error)
      .toMatchObject({ code: -32601 });

    const unknown = client.callTool('project.delete_everything').result as JsonObject;
    expect(unknown.status).toBe('failed');
    expect(JSON.stringify(unknown)).not.toContain('Hello \\V[1]');

    const invalidArgs = client.callTool('quality.review_file', { path: 42 as never }).result as JsonObject;
    expect(invalidArgs.status).toBe('failed');
    expect(JSON.stringify(invalidArgs)).not.toContain('api_key=secret-value');
  });

  it('redacts stable snapshots for audit, MCP results, failures, and handoffs', () => {
    const rawFailure: FailureArtifact = {
      schemaVersion: 1,
      failureId: 'failure-redaction',
      requestId: 'req-redaction',
      stage: 'mcp-call',
      message: 'Provider failed with Bearer raw-token-value',
      retryable: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      redactedDetails: {
        command: 'provider --api-key raw-command-secret',
        serviceAccountJson: '{"private_key":"raw-private-key"}',
      },
      handoff: {
        schemaVersion: 1,
        handoffId: 'handoff-redaction',
        createdAt: '2025-01-01T00:00:00.000Z',
        summary: 'Continue after token=raw-handoff-token was removed.',
        completedSteps: ['settings.get_sanitized'],
        nextSteps: ['provider.readiness'],
        artifacts: ['artifacts\\agent\\failure-redaction.json'],
        failureId: 'failure-redaction',
      },
    };
    const snapshot = redactSecretLikeValues({
      audit: {
        schemaVersion: 1,
        action: 'approval-requested',
        confirmToken: 'confirm-raw-token',
        args: { llmApiKey: 'AIza12345678901234567890', note: 'password=raw-password' },
      },
      mcpResult: {
        schemaVersion: 1,
        payload: { provider: 'gemini', authorization: 'Bearer raw-mcp-token' },
      },
      failure: rawFailure,
    } as unknown as JsonObject);

    expect(JSON.stringify(snapshot.value)).not.toContain('raw-token-value');
    expect(JSON.stringify(snapshot.value)).not.toContain('raw-command-secret');
    expect(JSON.stringify(snapshot.value)).not.toContain('raw-handoff-token');
    expect(snapshot.value).toMatchInlineSnapshot(`
      {
        "audit": {
          "action": "approval-requested",
          "args": {
            "llmApiKey": "[REDACTED]",
            "note": "[REDACTED]",
          },
          "confirmToken": "[REDACTED]",
          "schemaVersion": 1,
        },
        "failure": {
          "createdAt": "2025-01-01T00:00:00.000Z",
          "failureId": "failure-redaction",
          "handoff": {
            "artifacts": [
              "artifacts\\agent\\failure-redaction.json",
            ],
            "completedSteps": [
              "settings.get_sanitized",
            ],
            "createdAt": "2025-01-01T00:00:00.000Z",
            "failureId": "failure-redaction",
            "handoffId": "handoff-redaction",
            "nextSteps": [
              "provider.readiness",
            ],
            "schemaVersion": 1,
            "summary": "Continue after [REDACTED] was removed.",
          },
          "message": "Provider failed with [REDACTED]",
          "redactedDetails": {
            "command": "provider [REDACTED]",
            "serviceAccountJson": "[REDACTED]",
          },
          "requestId": "req-redaction",
          "retryable": false,
          "schemaVersion": 1,
          "stage": "mcp-call",
        },
        "mcpResult": {
          "payload": {
            "authorization": "[REDACTED]",
            "provider": "gemini",
          },
          "schemaVersion": 1,
        },
      }
    `);
  });

  it('keeps repair simulation and unapproved mutation calls from writing project files', () => {
    const projectRoot = makeRepairProject('no-unapproved-writes', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', 'Hello \\V[1]']);
    const service = new AgentService({ projectRoot, sessionId: 'session-a' });
    const registry = createMcpMutationToolRegistry(service, { sessionId: 'session-a' });
    const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
    const before = fs.readFileSync(targetPath, 'utf-8');

    const repair = service.repair.loopRun({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 1,
      maxIterations: 2,
    });
    expect(repair.dryRunOnly).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe(before);

    const patch = service.patch.propose({
      targetPath: 'Translated\\Map001.txt',
      lineNumber: 2,
      replacementText: '안녕 \\V[1]',
    }).patch;
    const unapproved = registry.callTool('patch.apply', { patch });
    expect(unapproved.status).toBe('needs-approval');
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe(before);
  });

  it('captures a terminal drawer snapshot with redacted, non-persistent output defaults', () => {
    const drawer = createAgentTerminalDrawerState('C:\\Games\\Fixture');
    const session = drawer.sessions[0];
    const event = createMockTerminalEvent(session.id, 1, 'stdout', '[REDACTED]');
    const updated = applyTerminalEvent(session, event);

    expect(validateTerminalEvent(event).ok).toBe(true);
    expect({
      isOpen: drawer.isOpen,
      activeSessionId: drawer.activeSessionId,
      session: {
        id: updated.id,
        state: updated.state,
        outputRetention: updated.outputRetention,
        persistOutput: updated.persistOutput,
        latestEventRedacted: updated.latestEvent?.redacted,
        latestEventData: updated.latestEvent?.data,
      },
    }).toMatchInlineSnapshot(`
      {
        "activeSessionId": "codex",
        "isOpen": false,
        "session": {
          "id": "codex",
          "latestEventData": "[REDACTED]",
          "latestEventRedacted": true,
          "outputRetention": "ephemeral",
          "persistOutput": false,
          "state": "created",
        },
      }
    `);
  });
});

function makeProject(prefix: string): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Extract'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.txt'), '--- 101 ---\nHello \\V[1]\napi_key=secret-value\n', 'utf-8');
  return root;
}

function makeRepairProject(prefix: string, sourceLines: string[], targetLines: string[]): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Source', 'Map001.txt'), sourceLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Source', 'Map001.extracteddata'), JSON.stringify({
    1: { val: 'events.1.pages.0.list.0.parameters.0', m: sourceLines.length + 1, origin: 'Map001.json' },
  }), 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
