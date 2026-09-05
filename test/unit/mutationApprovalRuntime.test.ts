import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MutationApprovalRuntime, MutationApprovalRuntimeError } from '../../src/agent/mutationApprovalRuntime';
import type {
  MutationApprovalQueueSnapshot,
  MutationApprovalResultView,
  PatchApplyProposalRequest,
  TranslationPatchOperation,
} from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mutationApprovalRuntime');
const cleanupDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MutationApprovalRuntime', () => {
  it('submits, lists, gets, and denies one request without exposing or writing patch data', () => {
    const projectRoot = makeProject('lifecycle', ['--- 101 ---', 'Hello \\V[1]']);
    const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
    const before = fs.readFileSync(targetPath);
    const snapshots: MutationApprovalQueueSnapshot[] = [];
    const runtime = new MutationApprovalRuntime({
      projectRoot,
      appSessionId: 'app-session-a',
      projectBindingId: 'project-binding-a',
      bridgeSessionId: 'bridge-session-a',
      onChanged: (snapshot) => snapshots.push(snapshot),
    });
    const request = makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '안녕 \\V[1]'),
    ]);

    const submitted = runtime.submit(request, 'renderer');
    const listed = runtime.list({ schemaVersion: 1 });
    const fetched = runtime.get({ schemaVersion: 1, approvalId: submitted.approvalId });
    const denied = runtime.deny({
      schemaVersion: 1,
      approvalId: submitted.approvalId,
      note: 'not now',
    });

    expect(listed).toHaveLength(1);
    expect(fetched.approvalId).toBe(submitted.approvalId);
    expect(denied).toMatchObject({ status: 'denied', denialNote: 'not now' });
    expect(fs.readFileSync(targetPath)).toEqual(before);
    expect(snapshots.at(-1)).toMatchObject({ pendingCount: 0 });

    const serialized = JSON.stringify({ submitted, listed, fetched, denied, snapshots });
    expect(serialized).not.toContain('confirm-');
    expect(serialized).not.toContain('app-session-a');
    expect(serialized).not.toContain('bridge-session-a');
    expect(serialized).not.toContain(path.resolve(projectRoot));
  });

  it('deduplicates identical submissions and rejects idempotency key reuse with changed args', () => {
    const projectRoot = makeProject('idempotency', ['Hello']);
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const request = makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]);

    const first = runtime.submit(request, 'mcp');
    const repeated = runtime.submit(structuredClone(request), 'mcp');
    const mutated = structuredClone(request);
    mutated.patch.operations[0].replacementText = '다른 번역';

    expect(repeated.approvalId).toBe(first.approvalId);
    expect(() => runtime.submit(mutated, 'mcp')).toThrowError(
      expect.objectContaining({ code: 'idempotency-conflict' }),
    );
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(1);
  });

  it('applies an approved patch through the default executor exactly once', async () => {
    const projectRoot = makeProject('default-executor', ['Hello']);
    const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const submitted = runtime.submit(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), 'renderer');

    const applied = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });

    expect(applied).toMatchObject({
      status: 'applied',
      result: {
        applied: true,
        targetPath: 'Translated/Map001.txt',
        operationsApplied: 1,
      },
    });
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('안녕');
    await expect(runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId }))
      .rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('replays an applied receipt after bytes change or the file disappears without applying twice', async () => {
    const projectRoot = makeProject('applied-retry', ['Hello']);
    const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const request = makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]);
    const submitted = runtime.submit(request, 'mcp');
    await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });
    const retry = { ...structuredClone(request), requestId: 'new-transport-request' };
    expect(runtime.submit(retry, 'mcp')).toMatchObject({ approvalId: submitted.approvalId, status: 'applied' });
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('안녕');
    fs.unlinkSync(targetPath);
    expect(runtime.submit(retry, 'mcp')).toMatchObject({ approvalId: submitted.approvalId, status: 'applied' });
    expect(fs.existsSync(targetPath)).toBe(false);
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(1);
    const changed = structuredClone(retry);
    changed.patch.operations[0].replacementText = 'different';
    expect(() => runtime.submit(changed, 'mcp')).toThrowError(expect.objectContaining({ code: 'idempotency-conflict' }));
    expect(() => runtime.submit({ ...retry, idempotencyKey: 'fresh-key' }, 'mcp'))
      .toThrowError(expect.objectContaining({ code: 'invalid-request' }));
  });

  it('replays denied receipts but still rejects invalid wire shapes', () => {
    const projectRoot = makeProject('denied-retry', ['Hello']);
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const request = makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]);
    const submitted = runtime.submit(request, 'mcp');
    runtime.deny({ schemaVersion: 1, approvalId: submitted.approvalId });
    fs.unlinkSync(path.join(projectRoot, 'Translated', 'Map001.txt'));
    expect(runtime.submit(structuredClone(request), 'mcp')).toMatchObject({ approvalId: submitted.approvalId, status: 'denied' });
    for (const invalid of [
      { ...request, schemaVersion: 2 },
      { ...request, extra: true },
      { ...request, requestId: '' },
      { ...request, patch: { ...request.patch, extra: true } },
      { ...request, patch: { ...request.patch, operations: Array.from({ length: 101 }, () => request.patch.operations[0]) } },
    ]) {
      expect(() => runtime.submit(invalid, 'mcp')).toThrowError(expect.objectContaining({ code: 'invalid-request' }));
    }
  });

  it('marks source drift stale before checking whether an executor is available', async () => {
    const projectRoot = makeProject('stale', ['Hello']);
    const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const submitted = runtime.submit(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), 'renderer');
    fs.writeFileSync(targetPath, 'Changed outside the approval runtime', 'utf-8');

    const stale = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });

    expect(stale).toMatchObject({
      status: 'stale',
      failure: { code: 'approval-stale', retryable: true },
    });
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('Changed outside the approval runtime');
  });

  it('claims concurrent approval once and leaves project writes to the injected executor', async () => {
    const projectRoot = makeProject('concurrent', ['Hello']);
    const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
    const before = fs.readFileSync(targetPath);
    let releaseExecutor!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseExecutor = resolve;
    });
    let executorCalls = 0;
    const runtime = new MutationApprovalRuntime({
      projectRoot,
      executor: async () => {
        executorCalls += 1;
        await gate;
        return appliedResult('Translated/Map001.txt');
      },
    });
    const submitted = runtime.submit(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), 'renderer');

    const firstApproval = runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });
    const replayApproval = runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });
    await expect(replayApproval).rejects.toBeInstanceOf(MutationApprovalRuntimeError);
    releaseExecutor();
    const applied = await firstApproval;

    expect(applied.status).toBe('applied');
    expect(executorCalls).toBe(1);
    expect(fs.readFileSync(targetPath)).toEqual(before);
    await expect(runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId }))
      .rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('cancels pending approvals on dispose and consumes no reusable capability', () => {
    const projectRoot = makeProject('dispose', ['Hello']);
    const snapshots: MutationApprovalQueueSnapshot[] = [];
    const runtime = new MutationApprovalRuntime({
      projectRoot,
      appSessionId: 'app-session-dispose',
      onChanged: (snapshot) => snapshots.push(snapshot),
    });
    const submitted = runtime.submit(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), 'renderer');
    const internalApproval = runtime.approvals.getApproval(submitted.approvalId);

    runtime.dispose('project-change');

    expect(snapshots.at(-1)?.approvals[0]).toMatchObject({
      status: 'cancelled',
      failure: { code: 'cancelled' },
    });
    expect(() => runtime.approvals.consumeConfirmation({
      toolName: 'patch.apply',
      args: { patch: makeRequest('Translated\\Map001.txt', []).patch },
      confirmToken: internalApproval?.confirmToken,
      sessionId: 'app-session-dispose',
    })).toThrow(/invalid or already used/);
    expect(() => runtime.list({ schemaVersion: 1 })).toThrowError(
      expect.objectContaining({ code: 'runtime-disposed' }),
    );
  });

  it('persists metadata and hashes but not patch text, tokens, sessions, or absolute paths', () => {
    const projectRoot = makeProject('audit', ['Secret source text']);
    const runtime = new MutationApprovalRuntime({
      projectRoot,
      appSessionId: 'app-session-private',
      bridgeSessionId: 'bridge-session-private',
    });
    runtime.submit(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Secret source text', '비밀 번역문'),
    ]), 'mcp');

    const auditPath = path.join(projectRoot, '.llm-tsukuru-agent', 'audit', 'approvals.jsonl');
    const audit = fs.readFileSync(auditPath, 'utf-8');

    expect(audit).toContain('"argsHash"');
    expect(audit).toContain('Translated/Map001.txt');
    expect(audit).not.toContain('Secret source text');
    expect(audit).not.toContain('비밀 번역문');
    expect(audit).not.toContain('confirm-');
    expect(audit).not.toContain('app-session-private');
    expect(audit).not.toContain('bridge-session-private');
    expect(audit).not.toContain(path.resolve(projectRoot));
  });
});

function makeRequest(targetPath: string, operations: TranslationPatchOperation[]): PatchApplyProposalRequest {
  return {
    schemaVersion: 1,
    requestId: `request-${sequence++}`,
    idempotencyKey: `idempotency-${sequence++}`,
    toolName: 'patch.apply',
    patch: {
      schemaVersion: 1,
      patchId: `patch-${sequence++}`,
      createdAt: '2026-07-29T00:00:00.000Z',
      dryRunOnly: true,
      targetPath,
      operations,
      invariantPolicy: {
        preserveLineCount: true,
        requiresAlignmentProofForLineCountChange: true,
      },
    },
  };
}

function replaceLine(
  opId: string,
  targetPath: string,
  lineNumber: number,
  originalText: string,
  replacementText: string,
): TranslationPatchOperation {
  return {
    opId,
    kind: 'replace-line',
    targetPath,
    lineNumber,
    originalText,
    replacementText,
  };
}

function appliedResult(targetPath: string): MutationApprovalResultView {
  return {
    schemaVersion: 1,
    applied: true,
    targetPath,
    operationsApplied: 1,
  };
}

function makeProject(prefix: string, targetLines: string[]): string {
  const root = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  cleanupDirs.push(root);
  return root;
}
