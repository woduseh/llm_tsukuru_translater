import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  MUTATION_APPROVAL_LIMITS,
  MutationApprovalStateError,
  toMutationApprovalBridgeView,
  toMutationApprovalRendererView,
  transitionMutationApproval,
  validateMutationApprovalBridgeView,
  validateMutationApprovalApproveRequest,
  validateMutationApprovalBinding,
  validateMutationApprovalDenyRequest,
  validateMutationApprovalGetRequest,
  validateMutationApprovalListRequest,
  validateMutationApprovalRendererView,
  validatePatchApplyProposalRequest,
  type MutationApprovalRecord,
  type ValidatedPatchApplyProposal,
} from '../../src/agent/mutationApprovalContracts';
import type {
  MutationApprovalFailureView,
  MutationApprovalResultView,
  PatchApplyProposalRequest,
  TranslationPatch,
  TranslationPatchOperation,
} from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mutationApprovalContracts');
const cleanupDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('mutation approval Phase 0 contracts', () => {
  it('validates and normalizes one bounded patch without writing project files', () => {
    const projectRoot = makeProject('valid', ['--- 101 ---', 'Hello \\V[1]', '', 'World']);
    const request = makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '안녕 \\V[1]'),
    ]);
    const before = snapshotProject(projectRoot);

    const result = validatePatchApplyProposalRequest(request, { projectRoot });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      targetRelativePath: 'Translated/Map001.txt',
      preview: {
        targetPath: 'Translated/Map001.txt',
        operations: [{ lineNumber: 2, before: 'Hello \\V[1]', after: '안녕 \\V[1]' }],
      },
      invariants: {
        lineCountPreserved: true,
        separatorsPreserved: true,
        emptyLinesPreserved: true,
        controlCodesPreserved: true,
      },
    });
    expect(result.value?.argsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.value?.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotProject(projectRoot)).toEqual(before);
  });

  it('keeps internal tokens, bindings, absolute paths, and patch args out of public views', () => {
    const projectRoot = makeProject('public-view', ['Hello']);
    const validated = requireValidated(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), projectRoot);
    const record = makeRecord(validated);

    const renderer = toMutationApprovalRendererView(record);
    const bridge = toMutationApprovalBridgeView(record);
    const serialized = JSON.stringify({ renderer, bridge });

    expect(serialized).not.toContain('confirm-secret');
    expect(serialized).not.toContain('bridge-session-secret');
    expect(serialized).not.toContain(path.resolve(projectRoot));
    expect(serialized).not.toContain('"patch"');
    expect(renderer.preview.operations[0]).toEqual(expect.objectContaining({ before: 'Hello', after: '안녕' }));
    expect(validateMutationApprovalRendererView(renderer).ok).toBe(true);
    expect(validateMutationApprovalBridgeView(bridge).ok).toBe(true);
    expect(validateMutationApprovalBridgeView({ ...bridge, confirmToken: 'leak' }).ok).toBe(false);
    expect(validateMutationApprovalBridgeView({ ...bridge, denialNote: 'private note' }).ok).toBe(false);

    const unsafeFailureView = toMutationApprovalBridgeView({
      ...record,
      status: 'failed',
      failure: {
        schemaVersion: 1,
        code: 'unexpected-C:\\private',
        message: 'token=raw-secret C:\\private\\Map001.txt',
        retryable: true,
      },
    });
    expect(JSON.stringify(unsafeFailureView)).not.toContain('raw-secret');
    expect(JSON.stringify(unsafeFailureView)).not.toContain('C:\\private');
    expect(unsafeFailureView.failure).toMatchObject({ code: 'internal-error', retryable: false });
  });

  it('rejects malformed, oversized, and overlong proposal inputs before queue insertion', () => {
    const projectRoot = makeProject('bounds', ['Hello']);
    const valid = makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]);
    const malformed = validatePatchApplyProposalRequest({ ...valid, toolName: 'patch.delete' }, { projectRoot });
    const tooMany = validatePatchApplyProposalRequest(makeRequest(
      'Translated\\Many.txt',
      Array.from({ length: MUTATION_APPROVAL_LIMITS.operations + 1 }, (_, index) => (
        replaceLine(`op-${index + 1}`, 'Translated\\Many.txt', index + 1, `Line ${index + 1}`, `번역 ${index + 1}`)
      )),
    ), { projectRoot });
    const overlongLine = validatePatchApplyProposalRequest(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '가'.repeat(MUTATION_APPROVAL_LIMITS.lineBytes)),
    ]), { projectRoot });
    const oversizedRequest = validatePatchApplyProposalRequest({
      ...valid,
      padding: 'x'.repeat(MUTATION_APPROVAL_LIMITS.requestBytes),
    }, { projectRoot });

    expect(malformed.errors).toContain('toolName must be patch.apply');
    expect(tooMany.errors.some((error) => error.includes('exceeds 100 operations'))).toBe(true);
    expect(overlongLine.errors.some((error) => error.includes('replacementText exceeds'))).toBe(true);
    expect(oversizedRequest.errors.some((error) => error.includes('request exceeds'))).toBe(true);
  });

  it('rejects a complete preview above the display bound instead of truncating it', () => {
    const beforeLines = Array.from({ length: 70 }, (_, index) => `${index}: ${'a'.repeat(1000)}`);
    const projectRoot = makeProject('preview-bound', ['Hello'], { 'Translated/Large.txt': beforeLines });
    const operations = beforeLines.map((line, index) => replaceLine(
      `op-${index + 1}`,
      'Translated\\Large.txt',
      index + 1,
      line,
      `${index}: ${'나'.repeat(340)}`,
    ));

    const result = validatePatchApplyProposalRequest(makeRequest('Translated\\Large.txt', operations), { projectRoot });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`preview exceeds ${MUTATION_APPROVAL_LIMITS.previewBytes} bytes; split the patch`);
  });

  it('rejects target files above the byte limit and invalid UTF-8 before previewing', () => {
    const oversizedRoot = makeProject('target-bound', ['Hello']);
    fs.writeFileSync(
      path.join(oversizedRoot, 'Translated', 'Map001.txt'),
      Buffer.alloc(MUTATION_APPROVAL_LIMITS.targetFileBytes + 1, 0x61),
    );
    const oversized = validatePatchApplyProposalRequest(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), { projectRoot: oversizedRoot });

    const invalidUtf8Root = makeProject('invalid-utf8', ['Hello']);
    fs.writeFileSync(path.join(invalidUtf8Root, 'Translated', 'Map001.txt'), Buffer.from([0xc3, 0x28]));
    const invalidUtf8 = validatePatchApplyProposalRequest(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), { projectRoot: invalidUtf8Root });

    expect(oversized.errors).toContain(`target file exceeds ${MUTATION_APPROVAL_LIMITS.targetFileBytes} bytes`);
    expect(invalidUtf8.ok).toBe(false);
    expect(invalidUtf8.errors.length).toBeGreaterThan(0);
  });

  it('rejects protected, escaped, non-text, and mixed-target paths', () => {
    const projectRoot = makeProject('paths', ['Hello'], {
      'Extract_backup/Map001.txt': ['Hello'],
      'Translated/Other.txt': ['Other'],
      'Translated/Map001.json': ['{"text":"Hello"}'],
    });
    const protectedResult = validatePatchApplyProposalRequest(makeRequest('Extract_backup\\Map001.txt', [
      replaceLine('op-001', 'Extract_backup\\Map001.txt', 1, 'Hello', '안녕'),
    ]), { projectRoot });
    const escapedResult = validatePatchApplyProposalRequest(makeRequest('..\\outside.txt', [
      replaceLine('op-001', '..\\outside.txt', 1, 'Hello', '안녕'),
    ]), { projectRoot });
    const jsonResult = validatePatchApplyProposalRequest(makeRequest('Translated\\Map001.json', [
      replaceLine('op-001', 'Translated\\Map001.json', 1, '{"text":"Hello"}', '{"text":"안녕"}'),
    ]), { projectRoot });
    const mixedResult = validatePatchApplyProposalRequest(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Other.txt', 1, 'Hello', '안녕'),
    ]), { projectRoot });

    expect(protectedResult.errors.some((error) => error.includes('protected'))).toBe(true);
    expect(escapedResult.errors.some((error) => error.includes('escapes allowed roots'))).toBe(true);
    expect(jsonResult.errors).toContain('patch.targetPath must name a .txt file');
    expect(mixedResult.errors.some((error) => error.includes('must match patch.targetPath'))).toBe(true);
  });

  it('rejects duplicate lines, virtual notes, source drift, empty-line changes, separators, and control-code drift', () => {
    const projectRoot = makeProject('invariants', ['--- 101 ---', 'Hello \\V[1]', '', 'World']);
    const cases: Array<{ request: PatchApplyProposalRequest; expected: string }> = [
      {
        request: makeRequest('Translated\\Map001.txt', [
          replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '안녕 \\V[1]'),
          replaceLine('op-002', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '다시 \\V[1]'),
        ]),
        expected: 'duplicates line 2',
      },
      {
        request: makeRequest('Translated\\Map001.txt', [{
          ...replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '안녕 \\V[1]'),
          kind: 'virtual-note',
          note: 'review',
        } as TranslationPatchOperation]),
        expected: 'kind must be replace-line',
      },
      {
        request: makeRequest('Translated\\Map001.txt', [
          replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Changed elsewhere', '안녕 \\V[1]'),
        ]),
        expected: 'does not match the current file',
      },
      {
        request: makeRequest('Translated\\Map001.txt', [
          replaceLine('op-001', 'Translated\\Map001.txt', 3, '', 'not empty'),
        ]),
        expected: 'preserve empty-line state',
      },
      {
        request: makeRequest('Translated\\Map001.txt', [
          replaceLine('op-001', 'Translated\\Map001.txt', 1, '--- 101 ---', '--- 102 ---'),
        ]),
        expected: 'must not change a separator line',
      },
      {
        request: makeRequest('Translated\\Map001.txt', [
          replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '안녕 \\V[2]'),
        ]),
        expected: 'preserve RPG control code sequence',
      },
    ];

    for (const item of cases) {
      const result = validatePatchApplyProposalRequest(item.request, { projectRoot });
      expect(result.errors.some((error) => error.includes(item.expected)), item.expected).toBe(true);
    }
  });

  it('validates list, get, approve, and bounded deny IPC request shapes', () => {
    expect(validateMutationApprovalListRequest({ schemaVersion: 1, statuses: ['pending', 'failed'] }).ok).toBe(true);
    expect(validateMutationApprovalListRequest({ schemaVersion: 1, statuses: ['pending', 'pending'] }).ok).toBe(false);
    expect(validateMutationApprovalGetRequest({ schemaVersion: 1, approvalId: 'approval-1' }).ok).toBe(true);
    expect(validateMutationApprovalApproveRequest({ schemaVersion: 1, approvalId: '' }).ok).toBe(false);
    expect(validateMutationApprovalDenyRequest({ schemaVersion: 1, approvalId: 'approval-1', note: '검토 후 거절' }).ok).toBe(true);
    expect(validateMutationApprovalDenyRequest({
      schemaVersion: 1,
      approvalId: 'approval-1',
      note: '가'.repeat(MUTATION_APPROVAL_LIMITS.denialNoteCharacters + 1),
    }).ok).toBe(false);
    expect(validateMutationApprovalGetRequest({ schemaVersion: 1, approvalId: 'approval-1', confirmToken: 'leak' }).ok).toBe(false);
  });

  it('fails closed for expired, cross-project, cross-session, stale, and mutated bindings', () => {
    const projectRoot = makeProject('bindings', ['Hello']);
    const validated = requireValidated(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), projectRoot);
    const record = makeRecord(validated);
    const validBinding = {
      appSessionId: record.appSessionId,
      projectBindingId: record.projectBindingId,
      bridgeSessionId: record.bridgeSessionId,
      argsHash: record.argsHash,
      sourceHash: record.sourceHash,
      previewHash: record.previewHash,
      now: new Date('2026-07-29T00:05:00.000Z'),
    };

    expect(validateMutationApprovalBinding(record, validBinding).ok).toBe(true);
    expect(validateMutationApprovalBinding(record, { ...validBinding, projectBindingId: 'other-project' }).errors)
      .toContain('project binding mismatch');
    expect(validateMutationApprovalBinding(record, { ...validBinding, appSessionId: 'other-app' }).errors)
      .toContain('app session mismatch');
    expect(validateMutationApprovalBinding(record, { ...validBinding, bridgeSessionId: 'other-bridge' }).errors)
      .toContain('bridge session mismatch');
    expect(validateMutationApprovalBinding(record, { ...validBinding, argsHash: sha256('mutated') }).errors)
      .toContain('arguments hash mismatch');
    expect(validateMutationApprovalBinding(record, { ...validBinding, sourceHash: sha256('changed source') }).errors)
      .toContain('source content is stale');
    expect(validateMutationApprovalBinding(record, { ...validBinding, previewHash: sha256('changed preview') }).errors)
      .toContain('preview hash mismatch');
    expect(validateMutationApprovalBinding(record, { ...validBinding, now: new Date(record.expiresAt) }).errors)
      .toContain('approval has expired');
  });

  it('enforces one-way state transitions and rejects replay after terminal outcomes', () => {
    const projectRoot = makeProject('state-machine', ['Hello']);
    const validated = requireValidated(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 1, 'Hello', '안녕'),
    ]), projectRoot);
    const record = makeRecord(validated);
    const result: MutationApprovalResultView = {
      schemaVersion: 1,
      applied: true,
      targetPath: record.affectedPaths[0],
      operationsApplied: 1,
    };

    const applying = transitionMutationApproval(record, { type: 'claim' });
    const applied = transitionMutationApproval(applying, { type: 'applied', result });
    expect(applied.status).toBe('applied');
    expect(() => transitionMutationApproval(applied, { type: 'claim' })).toThrow(MutationApprovalStateError);

    const denied = transitionMutationApproval(record, { type: 'deny', note: 'not now' });
    expect(denied.status).toBe('denied');
    expect(() => transitionMutationApproval(denied, { type: 'claim' })).toThrow(MutationApprovalStateError);

    const failure: MutationApprovalFailureView = {
      schemaVersion: 1,
      code: 'write-failed',
      message: 'write failed safely',
      retryable: false,
    };
    const failed = transitionMutationApproval(applying, { type: 'fail', failure });
    expect(failed.status).toBe('failed');
    expect(() => transitionMutationApproval(failed, { type: 'claim' })).toThrow(MutationApprovalStateError);
  });

  it('keeps proposal and denial paths byte-identical across the complete project fixture', () => {
    const projectRoot = makeProject('byte-identical', ['--- 101 ---', 'Hello \\V[1]', '', 'World'], {
      'Source/Map001.extracteddata': ['fixture metadata'],
    });
    const before = snapshotProject(projectRoot);
    const validated = requireValidated(makeRequest('Translated\\Map001.txt', [
      replaceLine('op-001', 'Translated\\Map001.txt', 2, 'Hello \\V[1]', '안녕 \\V[1]'),
    ]), projectRoot);
    const denied = transitionMutationApproval(makeRecord(validated), { type: 'deny' });

    expect(denied.status).toBe('denied');
    expect(snapshotProject(projectRoot)).toEqual(before);
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

function makeProject(
  prefix: string,
  targetLines: string[],
  extraFiles: Record<string, string[]> = {},
): string {
  const root = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  for (const [relativePath, lines] of Object.entries(extraFiles)) {
    const filePath = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }
  cleanupDirs.push(root);
  return root;
}

function requireValidated(
  request: PatchApplyProposalRequest,
  projectRoot: string,
): ValidatedPatchApplyProposal {
  const result = validatePatchApplyProposalRequest(request, { projectRoot });
  expect(result.errors).toEqual([]);
  if (!result.value) throw new Error('Expected validated proposal.');
  return result.value;
}

function makeRecord(validated: ValidatedPatchApplyProposal): MutationApprovalRecord {
  return {
    schemaVersion: 1,
    approvalId: 'approval-1',
    requestId: validated.request.requestId,
    idempotencyKey: validated.request.idempotencyKey,
    toolName: 'patch.apply',
    status: 'pending',
    requestSource: 'mcp',
    projectRoot: path.dirname(path.dirname(validated.targetAbsolutePath)),
    projectBindingId: 'project-binding-1',
    projectLabel: 'Fixture Project',
    appSessionId: 'app-session-secret',
    bridgeSessionId: 'bridge-session-secret',
    affectedPaths: [validated.targetRelativePath],
    patch: validated.request.patch,
    originalBytes: validated.originalBytes,
    argsHash: validated.argsHash,
    sourceHash: validated.sourceHash,
    previewHash: validated.previewHash,
    confirmToken: 'confirm-secret',
    preview: validated.preview,
    invariants: validated.invariants,
    createdAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T00:15:00.000Z',
  };
}

function snapshotProject(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
        snapshot[relativePath] = fs.readFileSync(absolutePath).toString('base64');
      }
    }
  };
  visit(root);
  return snapshot;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
