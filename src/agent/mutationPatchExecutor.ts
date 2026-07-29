import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import { atomicWriteTextFile, type AtomicWriteOptions } from '../ts/libs/atomicFile';
import type { MutationApprovalResultView } from '../types/agentWorkspace';
import {
  extractRpgControlCodes,
  isRpgSeparatorLine,
} from './patchService';
import {
  validatePatchApplyProposalRequest,
  type MutationApprovalRecord,
} from './mutationApprovalContracts';

type AtomicTextWriter = (
  filePath: string,
  content: string,
  options?: AtomicWriteOptions,
) => void;

export interface MutationPatchExecutorOptions {
  projectRoot: string;
  atomicWrite?: AtomicTextWriter;
}

export class MutationPatchExecutionError extends Error {
  constructor(
    readonly code: 'approval-stale' | 'write-failed' | 'verification-failed' | 'restore-failed',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MutationPatchExecutionError';
  }
}

export function createMutationPatchExecutor(options: MutationPatchExecutorOptions) {
  const projectRoot = canonicalRoot(options.projectRoot);
  const atomicWrite = options.atomicWrite ?? atomicWriteTextFile;

  return (record: Readonly<MutationApprovalRecord>): MutationApprovalResultView => {
    if (!samePath(record.projectRoot, projectRoot)) {
      throw new MutationPatchExecutionError(
        'approval-stale',
        'The selected project changed before execution.',
        true,
      );
    }
    const validated = validatePatchApplyProposalRequest({
      schemaVersion: 1,
      requestId: record.requestId,
      idempotencyKey: record.idempotencyKey,
      toolName: 'patch.apply',
      patch: record.patch,
    }, { projectRoot });
    if (!validated.ok || !validated.value) {
      throw new MutationPatchExecutionError(
        'approval-stale',
        'The target changed after preview. Submit a fresh proposal.',
        true,
      );
    }
    const current = validated.value;
    if (!current.originalBytes.equals(record.originalBytes)
        || !safeEqual(current.sourceHash, record.sourceHash)
        || !safeEqual(current.argsHash, record.argsHash)
        || !safeEqual(current.previewHash, record.previewHash)) {
      throw new MutationPatchExecutionError(
        'approval-stale',
        'The source or approved preview changed before execution.',
        true,
      );
    }

    const targetPath = current.targetAbsolutePath;
    const originalStat = fs.statSync(targetPath);
    const originalMode = originalStat.mode & 0o777;
    const originalLayout = decodeLayout(current.originalBytes);
    const nextLines = [...originalLayout.lines];
    for (const operation of current.request.patch.operations) {
      if (operation.kind !== 'replace-line') {
        throw new MutationPatchExecutionError(
          'approval-stale',
          'The approved patch contains a non-executable operation.',
          true,
        );
      }
      const index = operation.lineNumber - 1;
      if (originalLayout.lines[index] !== operation.originalText) {
        throw new MutationPatchExecutionError(
          'approval-stale',
          `The source changed at approved line ${operation.lineNumber}.`,
          true,
        );
      }
      nextLines[index] = operation.replacementText ?? '';
    }
    assertLineInvariants(originalLayout.lines, nextLines);
    const expectedText = encodeLayout(originalLayout, nextLines);
    const expectedBytes = Buffer.from(expectedText, 'utf-8');

    try {
      atomicWrite(targetPath, expectedText, { encoding: 'utf-8', mode: originalMode });
    } catch {
      throw new MutationPatchExecutionError(
        'write-failed',
        'The approved patch could not be written atomically.',
        false,
      );
    }

    try {
      verifyAppliedFile(targetPath, expectedBytes, originalLayout, nextLines, originalMode);
    } catch (error) {
      try {
        restoreOriginal(
          targetPath,
          current.originalBytes,
          originalMode,
          atomicWrite,
        );
      } catch {
        throw new MutationPatchExecutionError(
          'restore-failed',
          'Post-write verification failed and the original bytes could not be restored.',
          false,
        );
      }
      throw new MutationPatchExecutionError(
        'verification-failed',
        error instanceof Error ? error.message : 'Post-write verification failed.',
        true,
      );
    }

    return {
      schemaVersion: 1,
      applied: true,
      targetPath: current.targetRelativePath,
      operationsApplied: current.request.patch.operations.length,
    };
  };
}

interface TextLayout {
  bom: boolean;
  lines: string[];
  separators: string[];
}

function decodeLayout(bytes: Buffer): TextLayout {
  const bom = bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf;
  const contentBytes = bom ? bytes.subarray(3) : bytes;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes);
  const lines: string[] = [];
  const separators: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/\r\n|\n/g)) {
    const index = match.index;
    lines.push(text.slice(start, index));
    separators.push(match[0]);
    start = index + match[0].length;
  }
  lines.push(text.slice(start));
  return { bom, lines, separators };
}

function encodeLayout(layout: TextLayout, lines: string[]): string {
  let text = layout.bom ? '\uFEFF' : '';
  for (let index = 0; index < lines.length; index += 1) {
    text += lines[index];
    if (index < layout.separators.length) text += layout.separators[index];
  }
  return text;
}

function assertLineInvariants(before: string[], after: string[]): void {
  if (after.length !== before.length) {
    throw new MutationPatchExecutionError(
      'approval-stale',
      'The approved patch changed the total line count.',
      true,
    );
  }
  for (let index = 0; index < before.length; index += 1) {
    if ((before[index] === '') !== (after[index] === '')) {
      throw new MutationPatchExecutionError(
        'approval-stale',
        `The approved patch changed empty-line state at line ${index + 1}.`,
        true,
      );
    }
    if (isRpgSeparatorLine(before[index]) && before[index] !== after[index]) {
      throw new MutationPatchExecutionError(
        'approval-stale',
        `The approved patch changed a separator at line ${index + 1}.`,
        true,
      );
    }
    if (!sameStrings(extractRpgControlCodes(before[index]), extractRpgControlCodes(after[index]))) {
      throw new MutationPatchExecutionError(
        'approval-stale',
        `The approved patch changed control codes at line ${index + 1}.`,
        true,
      );
    }
  }
}

function verifyAppliedFile(
  targetPath: string,
  expectedBytes: Buffer,
  originalLayout: TextLayout,
  expectedLines: string[],
  expectedMode: number,
): void {
  const actualBytes = fs.readFileSync(targetPath);
  if (!actualBytes.equals(expectedBytes)) {
    throw new Error('Post-write byte verification failed.');
  }
  const actualLayout = decodeLayout(actualBytes);
  if (actualLayout.bom !== originalLayout.bom
      || !sameStrings(actualLayout.separators, originalLayout.separators)
      || !sameStrings(actualLayout.lines, expectedLines)) {
    throw new Error('Post-write text-layout verification failed.');
  }
  assertLineInvariants(originalLayout.lines, actualLayout.lines);
  if ((fs.statSync(targetPath).mode & 0o777) !== expectedMode) {
    throw new Error('Post-write file-mode verification failed.');
  }
}

function restoreOriginal(
  targetPath: string,
  originalBytes: Buffer,
  originalMode: number,
  atomicWrite: AtomicTextWriter,
): void {
  const originalText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(originalBytes);
  atomicWrite(targetPath, originalText, { encoding: 'utf-8', mode: originalMode });
  const restored = fs.readFileSync(targetPath);
  if (!restored.equals(originalBytes) || (fs.statSync(targetPath).mode & 0o777) !== originalMode) {
    throw new Error('Original byte restoration verification failed.');
  }
}

function canonicalRoot(projectRoot: string): string {
  return fs.realpathSync.native(path.resolve(projectRoot));
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf-8');
  const rightBytes = Buffer.from(right, 'utf-8');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
