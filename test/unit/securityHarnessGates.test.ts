import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolLightMcpClient, ProtocolLightMcpServer } from '../utils/mcpClient';
import * as fs from 'fs';
import * as path from 'path';
import {
  AgentSafeFileSystem,
  AgentService,
  SandboxPathError,
} from '../../src/agent';
import {
  redactSecretLikeValues,
  validateTerminalEvent,
} from '../../src/agent/contractsValidation';
import {
  createMcpOfflineToolRegistry,
  createMcpReadonlyToolRegistry,
} from '../../src/mcp';
import { applyTerminalEvent } from '../../src/renderer/agentWorkspaceModel';
import { createMockTerminalEvent } from '../utils/terminalFixtures';
import type { FailureArtifact, JsonObject, TerminalSessionSummary } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'securityHarnessGates');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('security harness gates', () => {
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

    expect(server.handle({} as never)?.error).toMatchObject({ code: -32600 });
    expect(server.handle({ jsonrpc: '2.0', id: 'bad-call', method: 'tools/call', params: { name: 7 } as never })?.error)
      .toMatchObject({ code: -32602 });
    expect(server.handle({ jsonrpc: '2.0', id: 'bad-method', method: 'resources/list' })?.error)
      .toMatchObject({ code: -32601 });

    const unknown = client.callTool('project.delete_everything').result as JsonObject;
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown)).not.toContain('Hello \\V[1]');

    const invalidArgs = client.callTool('quality.review_file', { path: 42 as never }).result as JsonObject;
    expect(invalidArgs.isError).toBe(true);
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

  it('keeps repair simulation read-only and rejects offline patch application', () => {
    const projectRoot = makeRepairProject('no-unapproved-writes', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', 'Hello \\V[1]']);
    const service = new AgentService({ projectRoot });
    const registry = createMcpOfflineToolRegistry(service);
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
    expect(unapproved.status).toBe('failed');
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe(before);
  });

  it('captures a terminal drawer snapshot with redacted, non-persistent output defaults', () => {
    const session: TerminalSessionSummary = {
      schemaVersion: 1,
      sessionId: 'term-fixture',
      label: 'Codex',
      kind: 'codex',
      state: 'running',
      cwdLabel: 'C:\\Games\\Fixture',
      outputRetention: 'ephemeral',
      persistOutput: false,
      latestSequence: 0,
      bridgeAttached: false,
      redactionCount: 0,
      truncationCount: 0,
    };
    const event = createMockTerminalEvent(session.sessionId, 1, 'stdout', '[REDACTED]');
    const updated = applyTerminalEvent(session, event);

    expect(validateTerminalEvent(event).ok).toBe(true);
    expect({
      activeSessionId: session.sessionId,
      session: {
        id: updated.sessionId,
        state: updated.state,
        outputRetention: updated.outputRetention,
        persistOutput: updated.persistOutput,
        latestSequence: updated.latestSequence,
      },
    }).toMatchInlineSnapshot(`
      {
        "activeSessionId": "term-fixture",
        "session": {
          "id": "term-fixture",
          "latestSequence": 1,
          "outputRetention": "ephemeral",
          "persistOutput": false,
          "state": "running",
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
