import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';
import { MUTATION_APPROVAL_LIMITS, validatePatchApplyProposalRequest } from '../../src/agent/mutationApprovalContracts';
import type { TranslationPatch } from '../../src/types/agentWorkspace';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(text = 'Hello\n\n--- 101 ---\nHello \\V[1]') {
  const base = path.resolve('artifacts', 'unit', 'patchApplyParity');
  fs.mkdirSync(base, { recursive: true });
  const projectRoot = fs.mkdtempSync(path.join(base, 'case-'));
  directories.push(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'translation.txt'), text);
  return { projectRoot, service: new AgentService({ projectRoot }) };
}

function applyCheck(projectRoot: string, patch: TranslationPatch) {
  return validatePatchApplyProposalRequest({
    schemaVersion: 1, requestId: 'parity-check', idempotencyKey: 'parity-check', toolName: 'patch.apply', patch,
  }, { projectRoot });
}

describe('patch proposal and approval validation parity', () => {
  it('generates a directly submit-ready valid proposal without changing files', () => {
    const { projectRoot, service } = fixture();
    const before = fs.readFileSync(path.join(projectRoot, 'translation.txt'));
    const proposal = service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1, replacementText: '안녕하세요' });
    expect(proposal.validation).toMatchObject({ valid: true, applicable: true, purpose: 'apply-proposal', requiresUserApproval: true });
    expect(applyCheck(projectRoot, proposal.patch).ok).toBe(true);
    expect(service.patch.preview(proposal.patch).validation.valid).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'translation.txt'))).toEqual(before);
  });

  it.each([
    [2, 'filled empty line', 'empty-line'],
    [1, '', 'empty-line'],
    [3, 'separator changed', 'separator'],
    [4, 'missing control code', 'control code'],
    [1, 'new\nline', 'newline'],
    [1, 'a'.repeat(MUTATION_APPROVAL_LIMITS.lineBytes + 1), 'exceeds'],
  ])('rejects line %s replacement that violates %s', (lineNumber, replacementText, reason) => {
    const { projectRoot, service } = fixture();
    const proposal = service.patch.propose({ targetPath: 'translation.txt', lineNumber: Number(lineNumber), replacementText: String(replacementText) });
    expect(proposal.validation.valid).toBe(false);
    expect(proposal.validation.applicable).toBe(false);
    const approval = applyCheck(projectRoot, proposal.patch);
    expect(approval.ok).toBe(false);
    expect(approval.errors.join(' ')).toContain(String(reason));
    expect(service.patch.preview(proposal.patch).validation.valid).toBe(false);
  });

  it('revalidates against the current file and rejects stale originals', () => {
    const { projectRoot, service } = fixture();
    const proposal = service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1, replacementText: '안녕' });
    fs.writeFileSync(path.join(projectRoot, 'translation.txt'), 'Changed');
    expect(service.patch.validate(proposal.patch).valid).toBe(false);
    expect(service.patch.preview(proposal.patch).validation.valid).toBe(false);
    expect(applyCheck(projectRoot, proposal.patch).ok).toBe(false);
  });

  it('rejects duplicate operations, excessive operations and mismatched target paths', () => {
    const { projectRoot, service } = fixture();
    const proposal = service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1, replacementText: '안녕' });
    fs.writeFileSync(path.join(projectRoot, 'other.txt'), 'Hello');
    for (const operations of [
      [proposal.patch.operations[0], { ...proposal.patch.operations[0], opId: 'second' }],
      Array.from({ length: MUTATION_APPROVAL_LIMITS.operations + 1 }, (_, index) => ({ ...proposal.patch.operations[0], opId: `op-${index}` })),
      [{ ...proposal.patch.operations[0], targetPath: 'other.txt' }],
    ]) {
      const patch = { ...proposal.patch, operations };
      expect(service.patch.validate(patch).valid).toBe(false);
      expect(applyCheck(projectRoot, patch).ok).toBe(false);
    }
  });

  it('marks virtual notes as analysis-only and inapplicable', () => {
    const { service } = fixture();
    const proposal = service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1, note: 'Review this translation.' });
    expect(proposal.validation).toMatchObject({ valid: false, applicable: false, purpose: 'analysis-only' });
  });

  it('refuses truncated proposals and previews and rejects large files on revalidation', () => {
    const { projectRoot, service } = fixture();
    const proposal = service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1, replacementText: '안녕' });
    fs.writeFileSync(path.join(projectRoot, 'translation.txt'), 'a'.repeat(MUTATION_APPROVAL_LIMITS.targetFileBytes + 1));
    expect(() => service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1, replacementText: '안녕' })).toThrow(/exceeds/);
    expect(() => service.patch.preview(proposal.patch)).toThrow(/incomplete/);
    expect(service.patch.validate(proposal.patch).valid).toBe(false);
  });

  it('rejects fractional line numbers rather than silently rounding', () => {
    const { service } = fixture();
    expect(() => service.patch.propose({ targetPath: 'translation.txt', lineNumber: 1.5, replacementText: '안녕' })).toThrow();
  });
});
