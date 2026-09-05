import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import type { ValidationResult } from './contractsValidation';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { hashArgs } from './approvalService';
import { extractRpgControlCodes, isRpgSeparatorLine } from './rpgTextInvariants';
import type {
  JsonObject,
  MutationApprovalApproveRequest,
  MutationApprovalBridgeView,
  MutationApprovalDenyRequest,
  MutationApprovalFailureView,
  MutationApprovalGetRequest,
  MutationApprovalInvariantSummary,
  MutationApprovalListRequest,
  MutationApprovalPreview,
  MutationApprovalRendererView,
  MutationApprovalResultView,
  MutationApprovalStatus,
  PatchApplyProposalRequest,
  TranslationPatch,
  TranslationPatchOperation,
} from '../types/agentWorkspace';

export const MUTATION_APPROVAL_LIMITS = {
  requestBytes: 256 * 1024,
  targetFileBytes: 256 * 1024,
  previewBytes: 128 * 1024,
  operations: 100,
  lineBytes: 8 * 1024,
  denialNoteCharacters: 500,
  idCharacters: 128,
  pathBytes: 1024,
  pendingRequests: 20,
  historyRecords: 100,
  approvalTtlMs: 15 * 60 * 1000,
} as const;

const MUTATION_APPROVAL_STATUSES: MutationApprovalStatus[] = [
  'pending',
  'applying',
  'applied',
  'denied',
  'expired',
  'stale',
  'failed',
  'cancelled',
];
const TERMINAL_MUTATION_APPROVAL_STATUSES = new Set<MutationApprovalStatus>([
  'applied',
  'denied',
  'expired',
  'stale',
  'failed',
  'cancelled',
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const SAFE_FAILURES: Record<string, { message: string; retryable: boolean }> = {
  'invalid-request': { message: 'The proposal is invalid. Correct it and submit a new request.', retryable: true },
  'approval-expired': { message: 'The approval expired. Submit a fresh proposal.', retryable: true },
  'approval-stale': { message: 'The target changed after preview. Submit a fresh proposal.', retryable: true },
  'project-changed': { message: 'The selected project changed. Submit the proposal for the current project.', retryable: true },
  'write-failed': { message: 'The patch was not applied because the atomic write failed.', retryable: false },
  'verification-failed': { message: 'Post-write verification failed and the original file was restored.', retryable: true },
  'restore-failed': { message: 'Post-write verification failed and the original file could not be restored.', retryable: false },
  cancelled: { message: 'The request was cancelled without applying the patch.', retryable: true },
};

export interface ValidatedPatchApplyProposal {
  request: PatchApplyProposalRequest;
  targetAbsolutePath: string;
  targetRelativePath: string;
  originalBytes: Buffer;
  argsHash: string;
  sourceHash: string;
  previewHash: string;
  preview: MutationApprovalPreview;
  invariants: MutationApprovalInvariantSummary;
}

export interface MutationApprovalRecord {
  schemaVersion: 1;
  approvalId: string;
  requestId: string;
  idempotencyKey: string;
  toolName: 'patch.apply';
  status: MutationApprovalStatus;
  requestSource: 'mcp' | 'renderer';
  projectRoot: string;
  projectBindingId: string;
  projectLabel: string;
  appSessionId: string;
  bridgeSessionId?: string;
  affectedPaths: string[];
  patch: TranslationPatch;
  originalBytes: Buffer;
  argsHash: string;
  sourceHash: string;
  previewHash: string;
  confirmToken: string;
  preview: MutationApprovalPreview;
  invariants: MutationApprovalInvariantSummary;
  createdAt: string;
  expiresAt: string;
  denialNote?: string;
  result?: MutationApprovalResultView;
  failure?: MutationApprovalFailureView;
}

export interface MutationApprovalBinding {
  appSessionId: string;
  projectBindingId: string;
  bridgeSessionId?: string;
  argsHash: string;
  sourceHash: string;
  previewHash: string;
  now: Date;
}

export type MutationApprovalTransition =
  | { type: 'claim' }
  | { type: 'applied'; result: MutationApprovalResultView }
  | { type: 'deny'; note?: string }
  | { type: 'expire' }
  | { type: 'mark-stale'; failure: MutationApprovalFailureView }
  | { type: 'fail'; failure: MutationApprovalFailureView }
  | { type: 'cancel'; failure?: MutationApprovalFailureView };

export class MutationApprovalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationApprovalStateError';
  }
}

/** Validate the full wire shape without requiring the target file to still exist. */
export function validatePatchApplyProposalShape(value: unknown): ValidationResult<PatchApplyProposalRequest> {
  const errors: string[] = [];
  const requestBytes = jsonByteLength(value);
  if (requestBytes === undefined) {
    errors.push('request must be JSON-serializable');
  } else if (requestBytes > MUTATION_APPROVAL_LIMITS.requestBytes) {
    errors.push(`request exceeds ${MUTATION_APPROVAL_LIMITS.requestBytes} bytes`);
  }
  if (!isPlainObject(value)) return failure([...errors, 'request must be an object']);
  rejectUnknownKeys(value, ['schemaVersion', 'requestId', 'idempotencyKey', 'toolName', 'patch'], 'request', errors);
  if (value.schemaVersion !== 1) errors.push('request.schemaVersion must be 1');
  validateIdentifier(value.requestId, 'requestId', errors);
  validateIdentifier(value.idempotencyKey, 'idempotencyKey', errors);
  if (value.toolName !== 'patch.apply') errors.push('toolName must be patch.apply');
  if (!isPlainObject(value.patch)) {
    errors.push('patch must be an object');
    return failure(errors);
  }

  const patchObject = value.patch;
  validatePatchShape(patchObject, errors);
  if (errors.length > 0) return failure(errors);
  return success(value as unknown as PatchApplyProposalRequest);
}

export function validatePatchApplyProposalRequest(
  input: unknown,
  context: { projectRoot: string },
): ValidationResult<ValidatedPatchApplyProposal> {
  const shape = validatePatchApplyProposalShape(input);
  if (!shape.ok || !shape.value) return failure(shape.errors);
  const value = shape.value;
  const errors: string[] = [];
  const patch = value.patch;
  let targetAbsolutePath: string;
  let targetRelativePath: string;
  let originalBytes: Buffer;
  let sourceText: string;
  try {
    const safeFiles = new AgentSafeFileSystem({ projectRoot: context.projectRoot });
    targetAbsolutePath = safeFiles.resolveAllowed(patch.targetPath);
    const stat = fs.statSync(targetAbsolutePath);
    if (!stat.isFile()) return failure(['patch.targetPath must name a regular file']);
    if (stat.size > MUTATION_APPROVAL_LIMITS.targetFileBytes) {
      return failure([`target file exceeds ${MUTATION_APPROVAL_LIMITS.targetFileBytes} bytes`]);
    }
    if (path.extname(targetAbsolutePath).toLowerCase() !== '.txt') {
      return failure(['patch.targetPath must name a .txt file']);
    }
    targetRelativePath = toPortableRelativePath(path.relative(path.resolve(context.projectRoot), targetAbsolutePath));
    if (isProtectedMutationPath(targetRelativePath)) {
      return failure(['patch.targetPath is inside a protected workspace or backup directory']);
    }
    originalBytes = fs.readFileSync(targetAbsolutePath);
    sourceText = decodeUtf8(originalBytes);
  } catch (error) {
    return failure([error instanceof Error ? error.message : String(error)]);
  }

  const normalizedOperations: TranslationPatchOperation[] = [];
  const previewLines: MutationApprovalPreview['operations'] = [];
  const sourceLines = sourceText.split(/\r?\n/);
  const seenLineNumbers = new Set<number>();
  for (let index = 0; index < patch.operations.length; index += 1) {
    const operation = patch.operations[index];
    const label = `patch.operations[${index}]`;
    let operationAbsolutePath: string;
    try {
      operationAbsolutePath = new AgentSafeFileSystem({ projectRoot: context.projectRoot }).resolveAllowed(operation.targetPath);
    } catch (error) {
      errors.push(`${label}.targetPath: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!samePath(operationAbsolutePath, targetAbsolutePath)) {
      errors.push(`${label}.targetPath must match patch.targetPath`);
    }
    if (seenLineNumbers.has(operation.lineNumber)) {
      errors.push(`${label}.lineNumber duplicates line ${operation.lineNumber}`);
    }
    seenLineNumbers.add(operation.lineNumber);
    if (operation.lineNumber < 1 || operation.lineNumber > sourceLines.length) {
      errors.push(`${label}.lineNumber is outside the target file`);
      continue;
    }
    const before = sourceLines[operation.lineNumber - 1];
    const originalText = operation.originalText as string;
    const replacementText = operation.replacementText as string;
    if (originalText !== before) errors.push(`${label}.originalText does not match the current file`);
    if ((before === '') !== (replacementText === '')) {
      errors.push(`${label} must preserve empty-line state`);
    }
    if (isRpgSeparatorLine(before) && replacementText !== before) {
      errors.push(`${label} must not change a separator line`);
    }
    if (!sameStrings(extractRpgControlCodes(before), extractRpgControlCodes(replacementText))) {
      errors.push(`${label} must preserve RPG control code sequence`);
    }
    normalizedOperations.push({
      ...operation,
      targetPath: targetRelativePath,
      originalText: before,
    });
    previewLines.push({
      opId: operation.opId,
      lineNumber: operation.lineNumber,
      before,
      after: replacementText,
    });
  }
  if (errors.length > 0) return failure(errors);

  const previewBase = {
    schemaVersion: 1,
    targetPath: targetRelativePath,
    operations: previewLines,
  } as const;
  const previewBytes = Buffer.byteLength(JSON.stringify(previewBase), 'utf-8');
  if (previewBytes > MUTATION_APPROVAL_LIMITS.previewBytes) {
    return failure([`preview exceeds ${MUTATION_APPROVAL_LIMITS.previewBytes} bytes; split the patch`]);
  }
  const preview: MutationApprovalPreview = { ...previewBase, serializedBytes: previewBytes };
  const normalizedPatch: TranslationPatch = {
    ...patch,
    targetPath: targetRelativePath,
    operations: normalizedOperations,
  };
  const request: PatchApplyProposalRequest = {
    schemaVersion: 1,
    requestId: value.requestId as string,
    idempotencyKey: value.idempotencyKey as string,
    toolName: 'patch.apply',
    patch: normalizedPatch,
  };
  const invariants: MutationApprovalInvariantSummary = {
    schemaVersion: 1,
    lineCountPreserved: true,
    separatorsPreserved: true,
    emptyLinesPreserved: true,
    controlCodesPreserved: true,
  };
  return success({
    request,
    targetAbsolutePath,
    targetRelativePath,
    originalBytes,
    argsHash: hashArgs({ patch: normalizedPatch as unknown as JsonObject }),
    sourceHash: sha256(originalBytes),
    previewHash: sha256(Buffer.from(JSON.stringify(preview), 'utf-8')),
    preview,
    invariants,
  });
}

export function validateMutationApprovalListRequest(value: unknown): ValidationResult<MutationApprovalListRequest> {
  const errors: string[] = [];
  if (!isPlainObject(value)) return failure(['request must be an object']);
  rejectUnknownKeys(value, ['schemaVersion', 'statuses'], 'request', errors);
  if (value.schemaVersion !== 1) errors.push('request.schemaVersion must be 1');
  if ('statuses' in value) {
    if (!Array.isArray(value.statuses)) {
      errors.push('statuses must be an array');
    } else {
      const seen = new Set<string>();
      value.statuses.forEach((status, index) => {
        if (typeof status !== 'string' || !MUTATION_APPROVAL_STATUSES.includes(status as MutationApprovalStatus)) {
          errors.push(`statuses[${index}] is invalid`);
        } else if (seen.has(status)) {
          errors.push(`statuses[${index}] is duplicated`);
        }
        if (typeof status === 'string') seen.add(status);
      });
    }
  }
  return errors.length > 0 ? failure(errors) : success(value as unknown as MutationApprovalListRequest);
}

export function validateMutationApprovalGetRequest(value: unknown): ValidationResult<MutationApprovalGetRequest> {
  return validateApprovalIdRequest<MutationApprovalGetRequest>(value);
}

export function validateMutationApprovalApproveRequest(value: unknown): ValidationResult<MutationApprovalApproveRequest> {
  return validateApprovalIdRequest<MutationApprovalApproveRequest>(value);
}

export function validateMutationApprovalDenyRequest(value: unknown): ValidationResult<MutationApprovalDenyRequest> {
  const errors: string[] = [];
  if (!isPlainObject(value)) return failure(['request must be an object']);
  rejectUnknownKeys(value, ['schemaVersion', 'approvalId', 'note'], 'request', errors);
  if (value.schemaVersion !== 1) errors.push('request.schemaVersion must be 1');
  validateIdentifier(value.approvalId, 'approvalId', errors);
  if ('note' in value) {
    if (typeof value.note !== 'string') {
      errors.push('note must be a string');
    } else if (Array.from(value.note).length > MUTATION_APPROVAL_LIMITS.denialNoteCharacters) {
      errors.push(`note exceeds ${MUTATION_APPROVAL_LIMITS.denialNoteCharacters} characters`);
    }
  }
  return errors.length > 0 ? failure(errors) : success(value as unknown as MutationApprovalDenyRequest);
}

export function validateMutationApprovalRendererView(value: unknown): ValidationResult<MutationApprovalRendererView> {
  return validateMutationApprovalPublicView<MutationApprovalRendererView>(value, true);
}

export function validateMutationApprovalBridgeView(value: unknown): ValidationResult<MutationApprovalBridgeView> {
  return validateMutationApprovalPublicView<MutationApprovalBridgeView>(value, false);
}

export function validateMutationApprovalBinding(
  record: MutationApprovalRecord,
  binding: MutationApprovalBinding,
): ValidationResult<MutationApprovalRecord> {
  const errors: string[] = [];
  if (record.status !== 'pending') errors.push(`approval is not pending: ${record.status}`);
  if (Date.parse(record.expiresAt) <= binding.now.getTime()) errors.push('approval has expired');
  if (record.appSessionId !== binding.appSessionId) errors.push('app session mismatch');
  if (record.projectBindingId !== binding.projectBindingId) errors.push('project binding mismatch');
  if ((record.bridgeSessionId ?? '') !== (binding.bridgeSessionId ?? '')) errors.push('bridge session mismatch');
  if (!safeEqual(record.argsHash, binding.argsHash)) errors.push('arguments hash mismatch');
  if (!safeEqual(record.sourceHash, binding.sourceHash)) errors.push('source content is stale');
  if (!safeEqual(record.previewHash, binding.previewHash)) errors.push('preview hash mismatch');
  return errors.length > 0 ? failure(errors) : success(record);
}

export function transitionMutationApproval(
  record: MutationApprovalRecord,
  transition: MutationApprovalTransition,
): MutationApprovalRecord {
  if (TERMINAL_MUTATION_APPROVAL_STATUSES.has(record.status)) {
    throw new MutationApprovalStateError(`Approval is terminal: ${record.status}.`);
  }
  switch (transition.type) {
    case 'claim':
      requireStatus(record, 'pending', transition.type);
      return { ...record, status: 'applying' };
    case 'applied':
      requireStatus(record, 'applying', transition.type);
      return { ...record, status: 'applied', result: transition.result, failure: undefined };
    case 'deny':
      requireStatus(record, 'pending', transition.type);
      return { ...record, status: 'denied', denialNote: transition.note };
    case 'expire':
      requireStatus(record, 'pending', transition.type);
      return { ...record, status: 'expired' };
    case 'mark-stale':
      requireStatus(record, 'pending', transition.type);
      return { ...record, status: 'stale', failure: transition.failure };
    case 'fail':
      requireStatus(record, 'applying', transition.type);
      return { ...record, status: 'failed', failure: transition.failure };
    case 'cancel':
      if (record.status !== 'pending' && record.status !== 'applying') {
        throw new MutationApprovalStateError(`Transition cancel requires pending or applying, received ${record.status}.`);
      }
      return { ...record, status: 'cancelled', failure: transition.failure };
  }
}

export function toMutationApprovalRendererView(record: MutationApprovalRecord): MutationApprovalRendererView {
  return {
    ...toMutationApprovalViewBase(record),
    ...(record.denialNote !== undefined ? { denialNote: record.denialNote } : {}),
  };
}

export function toMutationApprovalBridgeView(record: MutationApprovalRecord): MutationApprovalBridgeView {
  return toMutationApprovalViewBase(record);
}

function toMutationApprovalViewBase(record: MutationApprovalRecord): MutationApprovalBridgeView {
  return {
    schemaVersion: 1,
    approvalId: record.approvalId,
    requestId: record.requestId,
    toolName: record.toolName,
    status: record.status,
    requestSource: record.requestSource,
    projectLabel: record.projectLabel,
    affectedPaths: [...record.affectedPaths],
    preview: {
      ...record.preview,
      operations: record.preview.operations.map((operation) => ({ ...operation })),
    },
    invariants: { ...record.invariants },
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.result ? { result: { ...record.result } } : {}),
    ...(record.failure ? { failure: sanitizeMutationApprovalFailure(record.failure) } : {}),
  };
}

export function sanitizeMutationApprovalFailure(
  failure: MutationApprovalFailureView,
): MutationApprovalFailureView {
  const knownCode = Object.hasOwn(SAFE_FAILURES, failure.code);
  const safe = knownCode ? SAFE_FAILURES[failure.code] : {
    message: 'The request failed safely. Submit a fresh proposal or inspect the local app logs.',
    retryable: false,
  };
  return {
    schemaVersion: 1,
    code: knownCode ? failure.code : 'internal-error',
    message: safe.message,
    retryable: safe.retryable,
  };
}

function validatePatchShape(patch: Record<string, unknown>, errors: string[]): void {
  rejectUnknownKeys(
    patch,
    ['schemaVersion', 'patchId', 'createdAt', 'dryRunOnly', 'targetPath', 'operations', 'alignmentRef', 'invariantPolicy'],
    'patch',
    errors,
  );
  if (patch.schemaVersion !== 1) errors.push('patch.schemaVersion must be 1');
  validateIdentifier(patch.patchId, 'patch.patchId', errors);
  if (typeof patch.createdAt !== 'string' || Number.isNaN(Date.parse(patch.createdAt))) {
    errors.push('patch.createdAt must be an ISO date string');
  }
  if (patch.dryRunOnly !== true) errors.push('patch.dryRunOnly must be true');
  validateBoundedString(patch.targetPath, 'patch.targetPath', MUTATION_APPROVAL_LIMITS.pathBytes, errors);
  if (typeof patch.targetPath === 'string' && path.isAbsolute(patch.targetPath)) {
    errors.push('patch.targetPath must be relative');
  }
  if ('alignmentRef' in patch && typeof patch.alignmentRef !== 'string') {
    errors.push('patch.alignmentRef must be a string');
  }
  if (!isPlainObject(patch.invariantPolicy)
      || patch.invariantPolicy.preserveLineCount !== true
      || patch.invariantPolicy.requiresAlignmentProofForLineCountChange !== true) {
    errors.push('patch.invariantPolicy must require preserved line count and alignment proof');
  } else {
    rejectUnknownKeys(
      patch.invariantPolicy,
      ['preserveLineCount', 'requiresAlignmentProofForLineCountChange'],
      'patch.invariantPolicy',
      errors,
    );
  }
  if (!Array.isArray(patch.operations)) {
    errors.push('patch.operations must be an array');
    return;
  }
  if (patch.operations.length < 1) errors.push('patch.operations must not be empty');
  if (patch.operations.length > MUTATION_APPROVAL_LIMITS.operations) {
    errors.push(`patch.operations exceeds ${MUTATION_APPROVAL_LIMITS.operations} operations`);
  }
  patch.operations.forEach((operation, index) => validateOperationShape(operation, index, errors));
  const operationIds = new Set<string>();
  patch.operations.forEach((operation, index) => {
    if (!isPlainObject(operation) || typeof operation.opId !== 'string') return;
    if (operationIds.has(operation.opId)) errors.push(`patch.operations[${index}].opId is duplicated`);
    operationIds.add(operation.opId);
  });
}

function validateOperationShape(value: unknown, index: number, errors: string[]): void {
  const label = `patch.operations[${index}]`;
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  rejectUnknownKeys(
    value,
    ['opId', 'kind', 'targetPath', 'lineNumber', 'originalText', 'replacementText', 'note', 'alignmentProofRef'],
    label,
    errors,
  );
  validateIdentifier(value.opId, `${label}.opId`, errors);
  if (value.kind !== 'replace-line') errors.push(`${label}.kind must be replace-line`);
  validateBoundedString(value.targetPath, `${label}.targetPath`, MUTATION_APPROVAL_LIMITS.pathBytes, errors);
  if (typeof value.targetPath === 'string' && path.isAbsolute(value.targetPath)) {
    errors.push(`${label}.targetPath must be relative`);
  }
  if (typeof value.lineNumber !== 'number' || !Number.isInteger(value.lineNumber)) {
    errors.push(`${label}.lineNumber must be an integer`);
  }
  validateBoundedString(value.originalText, `${label}.originalText`, MUTATION_APPROVAL_LIMITS.lineBytes, errors, true);
  validateBoundedString(value.replacementText, `${label}.replacementText`, MUTATION_APPROVAL_LIMITS.lineBytes, errors, true);
  if (typeof value.replacementText === 'string' && /[\r\n]/.test(value.replacementText)) {
    errors.push(`${label}.replacementText must not contain a newline`);
  }
  if ('note' in value && typeof value.note !== 'string') errors.push(`${label}.note must be a string`);
  if ('alignmentProofRef' in value && typeof value.alignmentProofRef !== 'string') {
    errors.push(`${label}.alignmentProofRef must be a string`);
  }
}

function validateApprovalIdRequest<T extends MutationApprovalGetRequest | MutationApprovalApproveRequest>(
  value: unknown,
): ValidationResult<T> {
  const errors: string[] = [];
  if (!isPlainObject(value)) return failure(['request must be an object']);
  rejectUnknownKeys(value, ['schemaVersion', 'approvalId'], 'request', errors);
  if (value.schemaVersion !== 1) errors.push('request.schemaVersion must be 1');
  validateIdentifier(value.approvalId, 'approvalId', errors);
  return errors.length > 0 ? failure(errors) : success(value as unknown as T);
}

function validateMutationApprovalPublicView<T extends MutationApprovalRendererView | MutationApprovalBridgeView>(
  value: unknown,
  allowDenialNote: boolean,
): ValidationResult<T> {
  const errors: string[] = [];
  if (!isPlainObject(value)) return failure(['approval view must be an object']);
  const allowedKeys = [
    'schemaVersion',
    'approvalId',
    'requestId',
    'toolName',
    'status',
    'requestSource',
    'projectLabel',
    'affectedPaths',
    'preview',
    'invariants',
    'createdAt',
    'expiresAt',
    'result',
    'failure',
    ...(allowDenialNote ? ['denialNote'] : []),
  ];
  rejectUnknownKeys(value, allowedKeys, 'approvalView', errors);
  if (value.schemaVersion !== 1) errors.push('approvalView.schemaVersion must be 1');
  validateIdentifier(value.approvalId, 'approvalId', errors);
  validateIdentifier(value.requestId, 'requestId', errors);
  if (value.toolName !== 'patch.apply') errors.push('toolName must be patch.apply');
  if (typeof value.status !== 'string' || !MUTATION_APPROVAL_STATUSES.includes(value.status as MutationApprovalStatus)) {
    errors.push('status is invalid');
  }
  if (value.requestSource !== 'mcp' && value.requestSource !== 'renderer') {
    errors.push('requestSource must be mcp or renderer');
  }
  validateBoundedString(value.projectLabel, 'projectLabel', 1024, errors);
  validateRelativePathArray(value.affectedPaths, 'affectedPaths', errors);
  validatePreviewShape(value.preview, errors);
  validateInvariantShape(value.invariants, errors);
  validateIsoDate(value.createdAt, 'createdAt', errors);
  validateIsoDate(value.expiresAt, 'expiresAt', errors);
  if ('result' in value) validateResultViewShape(value.result, errors);
  if ('failure' in value) validateFailureViewShape(value.failure, errors);
  if ('denialNote' in value) {
    if (!allowDenialNote) {
      errors.push('approvalView.denialNote is not allowed');
    } else if (typeof value.denialNote !== 'string'
        || Array.from(value.denialNote).length > MUTATION_APPROVAL_LIMITS.denialNoteCharacters) {
      errors.push(`denialNote must be at most ${MUTATION_APPROVAL_LIMITS.denialNoteCharacters} characters`);
    }
  }
  return errors.length > 0 ? failure(errors) : success(value as unknown as T);
}

function validatePreviewShape(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('preview must be an object');
    return;
  }
  rejectUnknownKeys(value, ['schemaVersion', 'targetPath', 'operations', 'serializedBytes'], 'preview', errors);
  if (value.schemaVersion !== 1) errors.push('preview.schemaVersion must be 1');
  validateBoundedString(value.targetPath, 'preview.targetPath', MUTATION_APPROVAL_LIMITS.pathBytes, errors);
  if (typeof value.targetPath === 'string' && path.isAbsolute(value.targetPath)) {
    errors.push('preview.targetPath must be relative');
  }
  if (!Array.isArray(value.operations)) {
    errors.push('preview.operations must be an array');
  } else {
    if (value.operations.length > MUTATION_APPROVAL_LIMITS.operations) {
      errors.push(`preview.operations exceeds ${MUTATION_APPROVAL_LIMITS.operations} operations`);
    }
    value.operations.forEach((operation, index) => {
      const label = `preview.operations[${index}]`;
      if (!isPlainObject(operation)) {
        errors.push(`${label} must be an object`);
        return;
      }
      rejectUnknownKeys(operation, ['opId', 'lineNumber', 'before', 'after'], label, errors);
      validateIdentifier(operation.opId, `${label}.opId`, errors);
      if (typeof operation.lineNumber !== 'number' || !Number.isInteger(operation.lineNumber) || operation.lineNumber < 1) {
        errors.push(`${label}.lineNumber must be a positive integer`);
      }
      validateBoundedString(operation.before, `${label}.before`, MUTATION_APPROVAL_LIMITS.lineBytes, errors, true);
      validateBoundedString(operation.after, `${label}.after`, MUTATION_APPROVAL_LIMITS.lineBytes, errors, true);
    });
  }
  if (typeof value.serializedBytes !== 'number'
      || !Number.isInteger(value.serializedBytes)
      || value.serializedBytes < 0
      || value.serializedBytes > MUTATION_APPROVAL_LIMITS.previewBytes) {
    errors.push(`preview.serializedBytes must be 0-${MUTATION_APPROVAL_LIMITS.previewBytes}`);
  } else {
    const actualBytes = Buffer.byteLength(JSON.stringify({
      schemaVersion: value.schemaVersion,
      targetPath: value.targetPath,
      operations: value.operations,
    }), 'utf-8');
    if (value.serializedBytes !== actualBytes) errors.push('preview.serializedBytes does not match preview content');
  }
}

function validateInvariantShape(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('invariants must be an object');
    return;
  }
  rejectUnknownKeys(
    value,
    ['schemaVersion', 'lineCountPreserved', 'separatorsPreserved', 'emptyLinesPreserved', 'controlCodesPreserved'],
    'invariants',
    errors,
  );
  if (value.schemaVersion !== 1) errors.push('invariants.schemaVersion must be 1');
  for (const key of ['lineCountPreserved', 'separatorsPreserved', 'emptyLinesPreserved', 'controlCodesPreserved']) {
    if (value[key] !== true) errors.push(`invariants.${key} must be true`);
  }
}

function validateResultViewShape(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('result must be an object');
    return;
  }
  rejectUnknownKeys(value, ['schemaVersion', 'applied', 'targetPath', 'operationsApplied'], 'result', errors);
  if (value.schemaVersion !== 1 || value.applied !== true) errors.push('result must describe an applied schemaVersion 1 patch');
  validateBoundedString(value.targetPath, 'result.targetPath', MUTATION_APPROVAL_LIMITS.pathBytes, errors);
  if (typeof value.targetPath === 'string' && path.isAbsolute(value.targetPath)) {
    errors.push('result.targetPath must be relative');
  }
  if (typeof value.operationsApplied !== 'number' || !Number.isInteger(value.operationsApplied) || value.operationsApplied < 1) {
    errors.push('result.operationsApplied must be a positive integer');
  }
}

function validateFailureViewShape(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('failure must be an object');
    return;
  }
  rejectUnknownKeys(value, ['schemaVersion', 'code', 'message', 'retryable'], 'failure', errors);
  if (value.schemaVersion !== 1) errors.push('failure.schemaVersion must be 1');
  validateBoundedString(value.code, 'failure.code', 128, errors);
  validateBoundedString(value.message, 'failure.message', 4096, errors);
  if (typeof value.retryable !== 'boolean') errors.push('failure.retryable must be boolean');
}

function validateRelativePathArray(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length < 1) {
    errors.push(`${label} must be a non-empty array`);
    return;
  }
  value.forEach((item, index) => {
    validateBoundedString(item, `${label}[${index}]`, MUTATION_APPROVAL_LIMITS.pathBytes, errors);
    if (typeof item === 'string' && path.isAbsolute(item)) errors.push(`${label}[${index}] must be relative`);
  });
}

function validateIsoDate(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) errors.push(`${label} must be an ISO date string`);
}

function validateIdentifier(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > MUTATION_APPROVAL_LIMITS.idCharacters) {
    errors.push(`${label} must be 1-${MUTATION_APPROVAL_LIMITS.idCharacters} characters`);
  } else if (!REQUEST_ID_PATTERN.test(value)) {
    errors.push(`${label} contains unsupported characters`);
  }
}

function validateBoundedString(
  value: unknown,
  label: string,
  maxBytes: number,
  errors: string[],
  allowEmpty = false,
): void {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    errors.push(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  } else if (Buffer.byteLength(value, 'utf-8') > maxBytes) {
    errors.push(`${label} exceeds ${maxBytes} bytes`);
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function isProtectedMutationPath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .map((segment) => segment.toLowerCase())
    .some((segment) => segment === '.llm-tsukuru-agent' || segment === 'extract_backup' || segment.endsWith('_backup'));
}

function decodeUtf8(bytes: Buffer): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (decoded.includes('\u0000')) throw new Error('target file contains NUL bytes');
  return decoded;
}

function toPortableRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf-8');
  const rightBuffer = Buffer.from(right, 'utf-8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonByteLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : Buffer.byteLength(serialized, 'utf-8');
  } catch {
    return undefined;
  }
}

function requireStatus(
  record: MutationApprovalRecord,
  expected: MutationApprovalStatus,
  transition: MutationApprovalTransition['type'],
): void {
  if (record.status !== expected) {
    throw new MutationApprovalStateError(`Transition ${transition} requires ${expected}, received ${record.status}.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value, errors: [] };
}

function failure<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}
