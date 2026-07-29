import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createMutationPatchExecutor } from '../../src/agent/mutationPatchExecutor';
import { MutationApprovalRuntime } from '../../src/agent/mutationApprovalRuntime';
import { atomicWriteTextFile } from '../../src/ts/libs/atomicFile';
import type {
  PatchApplyProposalRequest,
  TranslationPatchOperation,
} from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mutationPatchExecutor');
const cleanupDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('mutation patch executor', () => {
  it('preserves BOM, mixed line endings, final newline, file mode, separators, and control codes', async () => {
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('--- 101 ---\r\nHello \\V[1]\n\r\nWorld\r\n', 'utf-8'),
    ]);
    const { projectRoot, targetPath } = makeProject('layout', original);
    fs.chmodSync(targetPath, 0o640);
    const expectedMode = fs.statSync(targetPath).mode & 0o777;
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const submitted = runtime.submit(makeRequest([
      replaceLine('op-001', 2, 'Hello \\V[1]', '안녕 \\V[1]'),
      replaceLine('op-002', 4, 'World', '세계'),
    ]), 'renderer');

    const applied = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });

    expect(applied.status).toBe('applied');
    expect(fs.readFileSync(targetPath)).toEqual(Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('--- 101 ---\r\n안녕 \\V[1]\n\r\n세계\r\n', 'utf-8'),
    ]));
    expect(fs.statSync(targetPath).mode & 0o777).toBe(expectedMode);
  });

  it('preserves an LF file without a final newline', async () => {
    const { projectRoot, targetPath } = makeProject(
      'no-final-newline',
      Buffer.from('--- 101 ---\nHello', 'utf-8'),
    );
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const submitted = runtime.submit(makeRequest([
      replaceLine('op-001', 2, 'Hello', '안녕'),
    ]), 'renderer');

    const applied = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });

    expect(applied.status).toBe('applied');
    expect(fs.readFileSync(targetPath)).toEqual(Buffer.from('--- 101 ---\n안녕', 'utf-8'));
  });

  it('restores the exact preimage when post-write verification detects corruption', async () => {
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('--- 101 ---\r\nHello\r\n', 'utf-8'),
    ]);
    const { projectRoot, targetPath } = makeProject('restore', original);
    let writes = 0;
    const executor = createMutationPatchExecutor({
      projectRoot,
      atomicWrite(filePath, content, options) {
        writes += 1;
        atomicWriteTextFile(filePath, content, options);
        if (writes === 1) fs.appendFileSync(filePath, 'corrupted', 'utf-8');
      },
    });
    const runtime = new MutationApprovalRuntime({ projectRoot, executor });
    const submitted = runtime.submit(makeRequest([
      replaceLine('op-001', 2, 'Hello', '안녕'),
    ]), 'renderer');

    const failed = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });

    expect(failed).toMatchObject({
      status: 'failed',
      failure: { code: 'verification-failed', retryable: true },
    });
    expect(writes).toBe(2);
    expect(fs.readFileSync(targetPath)).toEqual(original);
  });

  it('leaves the original file unchanged when the atomic write fails', async () => {
    const original = Buffer.from('--- 101 ---\nHello\n', 'utf-8');
    const { projectRoot, targetPath } = makeProject('write-failure', original);
    const executor = createMutationPatchExecutor({
      projectRoot,
      atomicWrite() {
        throw new Error('simulated write failure');
      },
    });
    const runtime = new MutationApprovalRuntime({ projectRoot, executor });
    const submitted = runtime.submit(makeRequest([
      replaceLine('op-001', 2, 'Hello', '안녕'),
    ]), 'renderer');

    const failed = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });

    expect(failed).toMatchObject({
      status: 'failed',
      failure: { code: 'write-failed', retryable: false },
    });
    expect(fs.readFileSync(targetPath)).toEqual(original);
  });

  it('records applied metadata and hashes without patch text, tokens, sessions, or absolute paths', async () => {
    const { projectRoot } = makeProject(
      'audit',
      Buffer.from('Secret source \\V[1]', 'utf-8'),
    );
    const runtime = new MutationApprovalRuntime({
      projectRoot,
      appSessionId: 'private-app-session',
      bridgeSessionId: 'private-bridge-session',
    });
    const submitted = runtime.submit(makeRequest([
      replaceLine('op-001', 1, 'Secret source \\V[1]', '비밀 번역 \\V[1]'),
    ]), 'mcp');

    const applied = await runtime.approve({ schemaVersion: 1, approvalId: submitted.approvalId });
    const audit = fs.readFileSync(
      path.join(projectRoot, '.llm-tsukuru-agent', 'audit', 'approvals.jsonl'),
      'utf-8',
    );

    expect(applied.status).toBe('applied');
    expect(audit).toContain('"action":"applied approved patch"');
    expect(audit).toContain('"argsHash"');
    expect(audit).not.toContain('Secret source');
    expect(audit).not.toContain('비밀 번역');
    expect(audit).not.toContain('confirm-');
    expect(audit).not.toContain('private-app-session');
    expect(audit).not.toContain('private-bridge-session');
    expect(audit).not.toContain(path.resolve(projectRoot));
  });
});

function makeProject(prefix: string, content: Buffer): { projectRoot: string; targetPath: string } {
  const projectRoot = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  cleanupDirs.push(projectRoot);
  return { projectRoot, targetPath };
}

function makeRequest(operations: TranslationPatchOperation[]): PatchApplyProposalRequest {
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
      targetPath: 'Translated/Map001.txt',
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
  lineNumber: number,
  originalText: string,
  replacementText: string,
): TranslationPatchOperation {
  return {
    opId,
    kind: 'replace-line',
    targetPath: 'Translated/Map001.txt',
    lineNumber,
    originalText,
    replacementText,
  };
}
