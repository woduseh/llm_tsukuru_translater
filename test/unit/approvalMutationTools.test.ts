import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent';
import { ApprovalService } from '../../src/agent/approvalService';
import { AgentEventBus } from '../../src/agent/eventBus';
import { createMcpMutationToolRegistry } from '../../src/mcp';
import type { AgentResultEnvelope, JsonObject, TranslationPatch } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'approvalMutationTools');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('approval-gated mutation tools', () => {
  it('requires approval without token and applies an approved same-line patch once', () => {
    const projectRoot = makeProject('patch-approved', ['--- 101 ---', 'Hello \\V[1]']);
    const service = new AgentService({ projectRoot, sessionId: 'session-a' });
    const registry = createMcpMutationToolRegistry(service, { sessionId: 'session-a' });
    const patch = service.patch.propose({
      targetPath: 'Translated\\Map001.txt',
      lineNumber: 2,
      replacementText: '안녕 \\V[1]',
    }).patch;

    const dryRun = registry.callTool('patch.apply', { patch, dryRun: true });
    expect(dryRun.status).toBe('ok');
    expect(fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8')).toContain('Hello');

    const approval = registry.callTool('patch.apply', { patch });
    expect(approval.status).toBe('needs-approval');
    expect(approval.approvalRequest?.argsHash).toBeTruthy();
    expect(fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8')).toContain('Hello');

    const token = approval.approvalRequest?.confirmToken as string;
    const applied = registry.callTool('patch.apply', { patch, confirmToken: token });
    expect(applied.status).toBe('ok');
    expect(fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8')).toContain('안녕 \\V[1]');

    const replay = registry.callTool('patch.apply', { patch, confirmToken: token });
    expect(replay.status).toBe('failed');
    expect(replay.failure?.message).toContain('already used');
  });

  it('rejects mutated args hashes and leaves files unchanged', () => {
    const projectRoot = makeProject('hash-mismatch', ['--- 101 ---', 'Hello \\V[1]']);
    const service = new AgentService({ projectRoot, sessionId: 'session-a' });
    const registry = createMcpMutationToolRegistry(service, { sessionId: 'session-a' });
    const patch = service.patch.propose({ targetPath: 'Translated\\Map001.txt', lineNumber: 2, replacementText: '안녕 \\V[1]' }).patch;
    const approval = registry.callTool('patch.apply', { patch });
    const mutatedPatch: TranslationPatch = {
      ...patch,
      operations: patch.operations.map((operation) => ({ ...operation, replacementText: '변조 \\V[1]' })),
    };

    const result = registry.callTool('patch.apply', { patch: mutatedPatch, confirmToken: approval.approvalRequest?.confirmToken as string });

    expect(result.status).toBe('failed');
    expect(result.failure?.message).toContain('args hash mismatch');
    expect(fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8')).toContain('Hello \\V[1]');
  });

  it('rejects denied approvals without changing files', () => {
    const projectRoot = makeProject('denied', ['--- 101 ---', 'Hello']);
    const service = new AgentService({ projectRoot });
    const registry = createMcpMutationToolRegistry(service);
    const patch = service.patch.propose({ targetPath: 'Translated\\Map001.txt', lineNumber: 2, replacementText: '안녕' }).patch;
    const approval = registry.callTool('patch.apply', { patch });
    service.approvals.updateApprovalStatus(approval.approvalRequest?.approvalId as string, 'denied');

    const denied = registry.callTool('patch.apply', { patch, confirmToken: approval.approvalRequest?.confirmToken as string });

    expect(denied.status).toBe('failed');
    expect(fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8')).toContain('Hello');
  });

  it('rejects expired and context-mismatched approval confirmations', () => {
    let now = new Date('2025-01-01T00:00:00.000Z');
    const bus = new AgentEventBus({ workspaceRoot: makeDir('approval-service') });
    const approvals = new ApprovalService({
      eventBus: bus,
      now: () => now,
      sessionId: 'session-a',
      tokenFactory: () => 'confirm-fixture',
    });
    const approval = approvals.planApproval({
      requestId: 'req-1',
      toolName: 'patch.apply',
      permissionTier: 'approval-required',
      reason: 'test',
      planOperation: 'test operation',
      affectedPaths: ['Translated\\Map001.txt'],
      args: { patchId: 'one' },
      ttlMs: 10,
    });

    expect(() => approvals.consumeConfirmation({ toolName: 'patch.apply', args: { patchId: 'one' }, confirmToken: approval.confirmToken, sessionId: 'other-session' })).toThrow('session mismatch');
    now = new Date('2025-01-01T00:00:01.000Z');
    expect(() => approvals.consumeConfirmation({ toolName: 'patch.apply', args: { patchId: 'one' }, confirmToken: approval.confirmToken, sessionId: 'session-a' })).toThrow('expired');
  });

  it('redacts secret-like args in audit JSONL records', () => {
    const projectRoot = makeProject('audit', ['--- 101 ---', 'Hello']);
    const service = new AgentService({ projectRoot });
    const registry = createMcpMutationToolRegistry(service);

    const result = registry.callTool('styleguide.apply_patch', { patch: { apiKey: 'super-secret-value', text: 'tone: polite' } as unknown as JsonObject });

    expect(result.status).toBe('needs-approval');
    const auditPath = path.join(projectRoot, '.llm-tsukuru-agent', 'audit', 'approvals.jsonl');
    const audit = fs.readFileSync(auditPath, 'utf-8');
    expect(audit).not.toContain('super-secret-value');
    expect(audit).toContain('[REDACTED]');
  });

  it('registers mutation tool scaffolds alongside read-only MCP tools', () => {
    const registry = createMcpMutationToolRegistry(new AgentService({ projectRoot: makeProject('registry', ['Hello']) }));
    expect(registry.listTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'patch.preview',
      'patch.apply',
      'styleguide.apply_patch',
      'glossary.apply_entries',
      'job.abort',
      'harness.run',
      'translate.run',
      'apply.run',
      'checkpoint.create',
    ]));
  });
});

function makeProject(prefix: string, targetLines: string[]): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
