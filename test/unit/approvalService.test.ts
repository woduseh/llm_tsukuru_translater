import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ApprovalService } from '../../src/agent/approvalService';
import { AgentEventBus } from '../../src/agent/eventBus';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const parent = path.resolve('artifacts/unit/approvalService');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  roots.push(root);
  let now = new Date('2025-01-01T00:00:00Z');
  const service = new ApprovalService({
    eventBus: new AgentEventBus({ workspaceRoot: root }),
    now: () => now,
    sessionId: 'session-a',
  });
  const args = { patchId: 'one' };
  const approval = service.planApproval({
    requestId: 'req-1', toolName: 'patch.apply', permissionTier: 'approval-required',
    reason: 'fixture', planOperation: 'replace line', affectedPaths: ['Translated/Map001.txt'], args, ttlMs: 10,
  });
  return { service, root, args, token: approval.confirmToken, advance: () => { now = new Date(now.getTime() + 11); } };
}

describe('ApprovalService', () => {
  it('binds confirmation to tool, session and exact arguments and consumes it once', () => {
    const { service, args, token } = setup();
    const input = { toolName: 'patch.apply', args, confirmToken: token };
    expect(() => service.consumeConfirmation({ ...input, toolName: 'other' })).toThrow('toolName mismatch');
    expect(() => service.consumeConfirmation({ ...input, sessionId: 'other' })).toThrow('session mismatch');
    expect(() => service.consumeConfirmation({ ...input, args: { patchId: 'changed' } })).toThrow('args hash mismatch');
    expect(service.consumeConfirmation(input).status).toBe('granted');
    expect(() => service.consumeConfirmation(input)).toThrow('already used');
  });

  it('rejects expired confirmations', () => {
    const { service, args, token, advance } = setup();
    advance();
    expect(() => service.consumeConfirmation({ toolName: 'patch.apply', args, confirmToken: token })).toThrow('expired');
  });

  it('redacts secrets in audit records', () => {
    const { service, root, token } = setup();
    service.writeToolAudit({ requestId: 'req-2', toolName: 'patch.apply', action: 'fixture', args: { apiKey: 'super-secret-value' }, status: 'failed' });
    const audit = fs.readFileSync(path.join(root, 'audit/approvals.jsonl'), 'utf8');
    expect(audit).not.toContain('super-secret-value');
    expect(audit).not.toContain(token);
    expect(audit).toContain('[REDACTED]');
  });
});
