import * as fs from 'fs';
import type { JsonObject, TranslationPatch, TranslationPatchOperation } from '../types/agentWorkspace';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';

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

export interface PatchApplyResult {
  schemaVersion: 1;
  applied: true;
  targetPath: string;
  lineCountBefore: number;
  lineCountAfter: number;
  operationsApplied: number;
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
    const read = this.options.files.readText(input.targetPath, { maxBytes: 256 * 1024 });
    const lines = read.text.split(/\r?\n/);
    const operations = input.operations?.length
      ? input.operations.map((operation, index) => normalizeOperation(operation, read.relativePath, lines, index))
      : [createSingleOperation(input, read.relativePath, lines)];
    const patch: TranslationPatch = {
      schemaVersion: 1,
      patchId: `patch-${Date.now()}`,
      createdAt: new Date().toISOString(),
      dryRunOnly: true,
      targetPath: read.relativePath,
      operations,
      alignmentRef: input.alignmentRef,
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
    for (const operation of patch.operations) {
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
        if (isSeparator(operation.originalText ?? '') && operation.originalText !== operation.replacementText) {
          findings.push({ severity: 'error', code: 'separator-replacement', opId: operation.opId, message: 'Separator lines must not be changed by same-line patches.' });
        }
        if (controlCodes(operation.originalText ?? '').join('\u0000') !== controlCodes(operation.replacementText ?? '').join('\u0000')) {
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
    return {
      schemaVersion: 1,
      valid: !findings.some((finding) => finding.severity === 'error'),
      lineCountPreserved: !findings.some((finding) => finding.code === 'line-count-changing-replacement'),
      findings,
    };
  }

  preview(patch: TranslationPatch): PatchPreviewResult {
    const read = this.options.files.readText(patch.targetPath, { maxBytes: 256 * 1024 });
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

  apply(patch: TranslationPatch): PatchApplyResult {
    const target = this.options.files.resolveAllowed(patch.targetPath);
    const original = stripBom(fs.readFileSync(target, 'utf-8'));
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);
    const validation = this.validate(patch);
    if (!validation.valid || !validation.lineCountPreserved) {
      throw new Error('patch.apply requires a valid same-line-count patch.');
    }
    const nextLines = [...lines];
    for (const operation of patch.operations) {
      if (operation.kind !== 'replace-line') continue;
      if (operation.originalText !== undefined && lines[operation.lineNumber - 1] !== operation.originalText) {
        throw new Error(`patch.apply original text mismatch at line ${operation.lineNumber}.`);
      }
      nextLines[operation.lineNumber - 1] = operation.replacementText ?? '';
    }
    if (nextLines.length !== lines.length) throw new Error('patch.apply refused line-count-changing write.');
    fs.writeFileSync(target, nextLines.join(newline), 'utf-8');
    return {
      schemaVersion: 1,
      applied: true,
      targetPath: patch.targetPath,
      lineCountBefore: lines.length,
      lineCountAfter: nextLines.length,
      operationsApplied: patch.operations.filter((operation) => operation.kind === 'replace-line').length,
      validation,
    };
  }
}

function createSingleOperation(input: PatchProposeOptions, targetPath: string, lines: string[]): TranslationPatchOperation {
  if (typeof input.lineNumber !== 'number' || !Number.isFinite(input.lineNumber)) {
    throw new Error('patch.propose requires lineNumber when operations are not provided.');
  }
  const lineNumber = Math.floor(input.lineNumber);
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
    replacementText: input.replacementText,
    note: input.note,
    alignmentProofRef: input.alignmentRef,
  };
}

function normalizeOperation(operation: TranslationPatchOperation, targetPath: string, lines: string[], index: number): TranslationPatchOperation {
  const lineNumber = Math.floor(operation.lineNumber);
  if (!Number.isFinite(lineNumber) || lineNumber < 1 || lineNumber > lines.length) throw new Error(`patch operation lineNumber out of range: ${operation.lineNumber}.`);
  return {
    ...operation,
    opId: operation.opId || `op-${String(index + 1).padStart(3, '0')}`,
    targetPath,
    lineNumber,
    originalText: operation.originalText ?? lines[lineNumber - 1],
  };
}

function isSeparator(line: string): boolean {
  return /^---\s*[^-]+?\s*---$/.test(line);
}

function controlCodes(line: string): string[] {
  return line.match(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g) ?? [];
}

function assertPath(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}
