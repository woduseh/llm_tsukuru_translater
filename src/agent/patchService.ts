import type { JsonObject, TranslationPatch, TranslationPatchOperation } from '../types/agentWorkspace';
import { randomUUID } from 'crypto';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';
import { MUTATION_APPROVAL_LIMITS, validatePatchApplyProposalRequest } from './mutationApprovalContracts';
import { extractRpgControlCodes, isRpgSeparatorLine } from './rpgTextInvariants';
export { extractRpgControlCodes, isRpgSeparatorLine } from './rpgTextInvariants';

export interface PatchProposeOptions {
  targetPath: string;
  lineNumber?: number;
  replacementText?: string;
  note?: string;
  operations?: TranslationPatchOperation[];
  alignmentRef?: string;
  ttlMs?: number;
}

export interface PatchProposeResult {
  schemaVersion: 1;
  patch: TranslationPatch;
  validation: PatchValidationResult;
  patchRef?: AgentDataRef;
}

export interface PatchValidationResult {
  schemaVersion: 1;
  valid: boolean;
  applicable: boolean;
  purpose: 'apply-proposal' | 'analysis-only';
  requiresUserApproval: true;
  lineCountPreserved: boolean;
  findings: JsonObject[];
}

export interface PatchPreviewResult {
  schemaVersion: 1;
  dryRunOnly: true;
  targetPath: string;
  lineCountBefore: number;
  lineCountAfter: number;
  hunks: JsonObject[];
  validation: PatchValidationResult;
}

export class PatchService {
  constructor(
    private readonly options: {
      files: AgentSafeFileSystem;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
    },
  ) {}

  propose(input: PatchProposeOptions): PatchProposeResult {
    assertPath(input.targetPath, 'patch.propose requires a non-empty targetPath.');
    const read = this.options.files.readText(input.targetPath, { maxBytes: MUTATION_APPROVAL_LIMITS.targetFileBytes });
    if (read.truncated) throw new Error(`Target file exceeds ${MUTATION_APPROVAL_LIMITS.targetFileBytes} bytes; bounded patch application cannot handle this file.`);
    const lines = read.text.split(/\r?\n/);
    const operations = input.operations?.length
      ? input.operations.map((operation, index) => normalizeOperation(operation, read.relativePath, lines, index))
      : [createSingleOperation(input, read.relativePath, lines)];
    const patch: TranslationPatch = {
      schemaVersion: 1,
      patchId: `patch-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      dryRunOnly: true,
      targetPath: read.relativePath,
      operations,
      ...(input.alignmentRef !== undefined ? { alignmentRef: input.alignmentRef } : {}),
      invariantPolicy: {
        preserveLineCount: true,
        requiresAlignmentProofForLineCountChange: true,
      },
    };
    const validation = this.validate(patch);
    const artifact = this.options.artifacts.writeJsonArtifact('translation-patch', patch.patchId, { patch, validation } as unknown as JsonObject);
    const patchRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'translation-patch',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'patch.propose', targetPath: read.relativePath },
    });
    return { schemaVersion: 1, patch, validation, patchRef };
  }

  validate(patch: TranslationPatch): PatchValidationResult {
    const findings: JsonObject[] = [];
    if (patch.schemaVersion !== 1 || patch.dryRunOnly !== true) {
      findings.push({ severity: 'error', code: 'invalid-patch-schema', message: 'Patch must be schemaVersion=1 and dryRunOnly=true.' });
    }
    if (!patch.invariantPolicy?.preserveLineCount) {
      findings.push({ severity: 'error', code: 'missing-line-count-policy', message: 'Patch must declare preserveLineCount=true.' });
    }
    for (const operation of Array.isArray(patch.operations) ? patch.operations : []) {
      if (!operation || typeof operation !== 'object') continue;
      if (operation.kind === 'replace-line') {
        if (typeof operation.replacementText !== 'string') {
          findings.push({ severity: 'error', code: 'missing-replacement', opId: operation.opId, message: 'replace-line requires replacementText.' });
        } else if (/[\r\n]/.test(operation.replacementText)) {
          findings.push({
            severity: 'error',
            code: 'line-count-changing-replacement',
            opId: operation.opId,
            message: 'Replacement text contains a newline. Line-count-changing patches require a future alignment proof and are rejected by this dry-run kernel.',
          });
        }
        if (isRpgSeparatorLine(operation.originalText ?? '') && operation.originalText !== operation.replacementText) {
          findings.push({ severity: 'error', code: 'separator-replacement', opId: operation.opId, message: 'Separator lines must not be changed by same-line patches.' });
        }
        if (extractRpgControlCodes(typeof operation.originalText === 'string' ? operation.originalText : '').join('\u0000') !== extractRpgControlCodes(typeof operation.replacementText === 'string' ? operation.replacementText : '').join('\u0000')) {
          findings.push({ severity: 'error', code: 'control-code-drift', opId: operation.opId, message: 'Replacement must preserve RPG control code sequence.' });
        }
      } else if (operation.kind === 'virtual-note') {
        if (typeof operation.note !== 'string' || operation.note.trim() === '') {
          findings.push({ severity: 'error', code: 'missing-note', opId: operation.opId, message: 'virtual-note requires a note.' });
        }
      } else {
        findings.push({ severity: 'error', code: 'unknown-operation', opId: operation.opId, message: `Unknown patch operation kind: ${String(operation.kind)}.` });
      }
    }
    // Use the exact same current-file, shape, size and invariant checks as the
    // approval bridge. A successful dry run must be a submit-ready proposal.
    const approvalValidation = validatePatchApplyProposalRequest({
      schemaVersion: 1,
      requestId: 'patch-validation',
      idempotencyKey: 'patch-validation',
      toolName: 'patch.apply',
      patch,
    }, { projectRoot: this.options.files.projectRoot });
    for (const message of approvalValidation.errors) {
      findings.push({ severity: 'error', code: 'apply-contract-violation', message });
    }
    const valid = !findings.some((finding) => finding.severity === 'error');
    return {
      schemaVersion: 1,
      valid,
      applicable: valid,
      purpose: Array.isArray(patch.operations) && patch.operations.some((operation) => operation?.kind === 'virtual-note') ? 'analysis-only' : 'apply-proposal',
      requiresUserApproval: true,
      lineCountPreserved: !findings.some((finding) => finding.code === 'line-count-changing-replacement'),
      findings,
    };
  }

  preview(patch: TranslationPatch): PatchPreviewResult {
    const read = this.options.files.readText(patch.targetPath, { maxBytes: MUTATION_APPROVAL_LIMITS.targetFileBytes });
    if (read.truncated) throw new Error(`Target file exceeds ${MUTATION_APPROVAL_LIMITS.targetFileBytes} bytes; preview would be incomplete.`);
    const lines = read.text.split(/\r?\n/);
    const validation = this.validate(patch);
    const previewLines = [...lines];
    const hunks = patch.operations.map((operation) => {
      const before = lines[operation.lineNumber - 1] ?? '';
      if (operation.kind === 'replace-line' && validation.valid) {
        previewLines[operation.lineNumber - 1] = operation.replacementText ?? '';
      }
      const hunk: JsonObject = {
        opId: operation.opId,
        kind: operation.kind,
        lineNumber: operation.lineNumber,
        before,
        after: operation.kind === 'replace-line' ? operation.replacementText ?? '' : before,
      };
      if (operation.note) hunk.note = operation.note;
      return hunk;
    });
    return {
      schemaVersion: 1,
      dryRunOnly: true,
      targetPath: read.relativePath,
      lineCountBefore: lines.length,
      lineCountAfter: previewLines.length,
      hunks,
      validation,
    };
  }

}

function createSingleOperation(input: PatchProposeOptions, targetPath: string, lines: string[]): TranslationPatchOperation {
  if (typeof input.lineNumber !== 'number' || !Number.isInteger(input.lineNumber)) {
    throw new Error('patch.propose requires lineNumber when operations are not provided.');
  }
  const lineNumber = input.lineNumber;
  if (lineNumber < 1 || lineNumber > lines.length) throw new Error(`patch.propose lineNumber out of range: ${lineNumber}.`);
  if (typeof input.replacementText !== 'string' && typeof input.note !== 'string') {
    throw new Error('patch.propose requires replacementText or note.');
  }
  return {
    opId: 'op-001',
    kind: typeof input.replacementText === 'string' ? 'replace-line' : 'virtual-note',
    targetPath,
    lineNumber,
    originalText: lines[lineNumber - 1],
    ...(input.replacementText !== undefined ? { replacementText: input.replacementText } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.alignmentRef !== undefined ? { alignmentProofRef: input.alignmentRef } : {}),
  };
}

function normalizeOperation(operation: TranslationPatchOperation, targetPath: string, lines: string[], index: number): TranslationPatchOperation {
  const lineNumber = operation.lineNumber;
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) throw new Error(`patch operation lineNumber out of range: ${operation.lineNumber}.`);
  return {
    ...operation,
    opId: operation.opId || `op-${String(index + 1).padStart(3, '0')}`,
    targetPath: operation.targetPath || targetPath,
    lineNumber,
    originalText: operation.originalText ?? lines[lineNumber - 1],
  };
}

function assertPath(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
}
