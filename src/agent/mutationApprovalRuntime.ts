import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ApprovalService, hashArgs } from './approvalService';
import { AgentEventBus } from './eventBus';
import { AGENT_WORKSPACE_DIRECTORY } from './workspaceService';
import {
  createMutationPatchExecutor,
  MutationPatchExecutionError,
} from './mutationPatchExecutor';
import {
  MUTATION_APPROVAL_LIMITS,
  toMutationApprovalBridgeView,
  toMutationApprovalRendererView,
  transitionMutationApproval,
  validateMutationApprovalApproveRequest,
  validateMutationApprovalBinding,
  validateMutationApprovalDenyRequest,
  validateMutationApprovalGetRequest,
  validateMutationApprovalListRequest,
  validatePatchApplyProposalRequest,
  validatePatchApplyProposalShape,
  type MutationApprovalRecord,
} from './mutationApprovalContracts';
import type {
  JsonObject,
  MutationApprovalBridgeView,
  MutationApprovalQueueSnapshot,
  MutationApprovalRendererView,
  MutationApprovalResultView,
  PatchApplyProposalRequest,
} from '../types/agentWorkspace';

export type MutationApprovalExecutor = (
  record: Readonly<MutationApprovalRecord>,
) => MutationApprovalResultView | Promise<MutationApprovalResultView>;

export interface MutationApprovalRuntimeOptions {
  projectRoot: string;
  projectLabel?: string;
  appSessionId?: string;
  projectBindingId?: string;
  bridgeSessionId?: string;
  now?: () => Date;
  executor?: MutationApprovalExecutor;
  onChanged?: (snapshot: MutationApprovalQueueSnapshot) => void;
}

export class MutationApprovalRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MutationApprovalRuntimeError';
  }
}

export class MutationApprovalRuntime {
  readonly projectRoot: string;
  readonly projectLabel: string;
  readonly appSessionId: string;
  readonly projectBindingId: string;
  readonly bridgeSessionId: string;
  readonly approvals: ApprovalService;

  private readonly now: () => Date;
  private readonly executor: MutationApprovalExecutor;
  private readonly onChanged?: (snapshot: MutationApprovalQueueSnapshot) => void;
  private readonly records = new Map<string, MutationApprovalRecord>();
  private readonly idempotencyIndex = new Map<string, { approvalId: string; receiptHash: string }>();
  private disposed = false;

  constructor(options: MutationApprovalRuntimeOptions) {
    this.projectRoot = canonicalProjectRoot(options.projectRoot);
    this.projectLabel = options.projectLabel?.trim() || path.basename(this.projectRoot);
    this.appSessionId = options.appSessionId ?? `app-${crypto.randomUUID()}`;
    this.projectBindingId = options.projectBindingId ?? `project-${crypto.randomUUID()}`;
    this.bridgeSessionId = options.bridgeSessionId ?? `bridge-${crypto.randomUUID()}`;
    this.now = options.now ?? (() => new Date());
    const workspaceRoot = path.join(this.projectRoot, AGENT_WORKSPACE_DIRECTORY);
    this.approvals = new ApprovalService({
      eventBus: new AgentEventBus({ workspaceRoot }),
      auditRoot: workspaceRoot,
      sessionId: this.appSessionId,
      auditMode: 'metadata-only',
      now: this.now,
    });
    this.executor = options.executor ?? createMutationPatchExecutor({ projectRoot: this.projectRoot });
    this.onChanged = options.onChanged;
  }

  submit(value: unknown, requestSource: 'mcp' | 'renderer'): MutationApprovalRendererView {
    this.assertActive();
    const shape = validatePatchApplyProposalShape(value);
    if (!shape.ok || !shape.value) {
      throw new MutationApprovalRuntimeError(
        'invalid-request',
        safeValidationMessage(shape.errors, this.projectRoot),
      );
    }
    // Hash the received patch, before full validation canonicalizes paths. A
    // retry is a receipt lookup and must work after application changes bytes.
    const receiptHash = hashArgs(approvalArgs(shape.value));
    const receipt = this.idempotencyIndex.get(shape.value.idempotencyKey);
    if (receipt) {
      const existing = this.records.get(receipt.approvalId);
      if (!existing) {
        this.idempotencyIndex.delete(shape.value.idempotencyKey);
      } else if (!safeEqual(receipt.receiptHash, receiptHash)) {
        throw new MutationApprovalRuntimeError(
          'idempotency-conflict',
          'The idempotency key was already used with different patch arguments.',
        );
      } else {
        this.expirePending();
        return toMutationApprovalRendererView(this.requireRecord(existing.approvalId));
      }
    }
    const validated = validatePatchApplyProposalRequest(value, { projectRoot: this.projectRoot });
    if (!validated.ok || !validated.value) {
      throw new MutationApprovalRuntimeError('invalid-request', safeValidationMessage(validated.errors, this.projectRoot));
    }
    const proposal = validated.value;
    this.expirePending();
    if (this.pendingCount() >= MUTATION_APPROVAL_LIMITS.pendingRequests) {
      throw new MutationApprovalRuntimeError(
        'pending-limit',
        `At most ${MUTATION_APPROVAL_LIMITS.pendingRequests} approval requests may be pending.`,
      );
    }
    this.trimHistory();
    const approval = this.approvals.planApproval({
      requestId: proposal.request.requestId,
      toolName: 'patch.apply',
      permissionTier: 'approval-required',
      reason: 'patch.apply can modify one translation text file.',
      planOperation: 'apply one bounded same-line-count translation patch',
      affectedPaths: [proposal.targetRelativePath],
      args: approvalArgs(proposal.request),
      ttlMs: MUTATION_APPROVAL_LIMITS.approvalTtlMs,
      sessionId: this.appSessionId,
    });
    if (!approval.confirmToken) {
      throw new MutationApprovalRuntimeError('internal-error', 'The approval token was not created.');
    }
    const record: MutationApprovalRecord = {
      schemaVersion: 1,
      approvalId: approval.approvalId,
      requestId: proposal.request.requestId,
      idempotencyKey: proposal.request.idempotencyKey,
      toolName: 'patch.apply',
      status: 'pending',
      requestSource,
      projectRoot: this.projectRoot,
      projectBindingId: this.projectBindingId,
      projectLabel: this.projectLabel,
      appSessionId: this.appSessionId,
      bridgeSessionId: requestSource === 'mcp' ? this.bridgeSessionId : undefined,
      affectedPaths: [proposal.targetRelativePath],
      patch: proposal.request.patch,
      originalBytes: proposal.originalBytes,
      argsHash: proposal.argsHash,
      sourceHash: proposal.sourceHash,
      previewHash: proposal.previewHash,
      confirmToken: approval.confirmToken,
      preview: proposal.preview,
      invariants: proposal.invariants,
      createdAt: this.now().toISOString(),
      expiresAt: approval.expiresAt,
    };
    this.records.set(record.approvalId, record);
    this.idempotencyIndex.set(record.idempotencyKey, { approvalId: record.approvalId, receiptHash });
    this.emitChanged();
    return toMutationApprovalRendererView(record);
  }

  list(value: unknown): MutationApprovalRendererView[] {
    this.assertActive();
    const request = validateMutationApprovalListRequest(value);
    if (!request.ok || !request.value) {
      throw new MutationApprovalRuntimeError('invalid-request', request.errors.join('; '));
    }
    this.expirePending();
    const statuses = request.value.statuses ? new Set(request.value.statuses) : undefined;
    return this.sortedRecords()
      .filter((record) => !statuses || statuses.has(record.status))
      .map(toMutationApprovalRendererView);
  }

  get(value: unknown): MutationApprovalRendererView {
    this.assertActive();
    const request = validateMutationApprovalGetRequest(value);
    if (!request.ok || !request.value) {
      throw new MutationApprovalRuntimeError('invalid-request', request.errors.join('; '));
    }
    this.expirePending();
    return toMutationApprovalRendererView(this.requireRecord(request.value.approvalId));
  }

  getBridge(value: unknown): MutationApprovalBridgeView {
    this.assertActive();
    const request = validateMutationApprovalGetRequest(value);
    if (!request.ok || !request.value) {
      throw new MutationApprovalRuntimeError('invalid-request', request.errors.join('; '));
    }
    this.expirePending();
    return toMutationApprovalBridgeView(this.requireRecord(request.value.approvalId));
  }

  deny(value: unknown): MutationApprovalRendererView {
    this.assertActive();
    const request = validateMutationApprovalDenyRequest(value);
    if (!request.ok || !request.value) {
      throw new MutationApprovalRuntimeError('invalid-request', request.errors.join('; '));
    }
    this.expirePending();
    const record = this.requireRecord(request.value.approvalId);
    if (record.status !== 'pending') {
      throw new MutationApprovalRuntimeError('invalid-state', `Approval is not pending: ${record.status}.`);
    }
    const denied = transitionMutationApproval(record, { type: 'deny', note: request.value.note });
    this.records.set(denied.approvalId, denied);
    this.approvals.updateApprovalStatus(denied.approvalId, 'denied');
    this.emitChanged();
    return toMutationApprovalRendererView(denied);
  }

  async approve(value: unknown): Promise<MutationApprovalRendererView> {
    this.assertActive();
    const request = validateMutationApprovalApproveRequest(value);
    if (!request.ok || !request.value) {
      throw new MutationApprovalRuntimeError('invalid-request', request.errors.join('; '));
    }
    this.expirePending();
    const record = this.requireRecord(request.value.approvalId);
    const current = validatePatchApplyProposalRequest({
      schemaVersion: 1,
      requestId: record.requestId,
      idempotencyKey: record.idempotencyKey,
      toolName: 'patch.apply',
      patch: record.patch,
    }, { projectRoot: this.projectRoot });
    if (!current.ok || !current.value) {
      return this.markStale(record);
    }
    const binding = validateMutationApprovalBinding(record, {
      appSessionId: this.appSessionId,
      projectBindingId: this.projectBindingId,
      bridgeSessionId: record.bridgeSessionId,
      argsHash: current.value.argsHash,
      sourceHash: current.value.sourceHash,
      previewHash: current.value.previewHash,
      now: this.now(),
    });
    if (!binding.ok) return this.markStale(record);
    const applying = transitionMutationApproval(record, { type: 'claim' });
    this.records.set(applying.approvalId, applying);
    this.emitChanged();
    try {
      this.approvals.consumeConfirmation({
        toolName: 'patch.apply',
        args: approvalArgs(current.value.request),
        confirmToken: applying.confirmToken,
        sessionId: this.appSessionId,
      });
      const result = await this.executor(applying);
      const latest = this.records.get(applying.approvalId);
      if (!latest || latest.status !== 'applying' || this.disposed) {
        throw new MutationApprovalRuntimeError(
          'approval-cancelled',
          'The approval was cancelled before execution completed.',
        );
      }
      const applied = transitionMutationApproval(latest, { type: 'applied', result });
      this.records.set(applied.approvalId, applied);
      this.approvals.writeToolAudit({
        requestId: applied.requestId,
        toolName: 'patch.apply',
        action: 'applied approved patch',
        args: approvalArgs(current.value.request),
        status: 'ok',
        paths: applied.affectedPaths,
      });
      this.emitChanged();
      return toMutationApprovalRendererView(applied);
    } catch (error) {
      const latest = this.records.get(applying.approvalId);
      if (latest?.status !== 'applying') {
        throw error;
      }
      const failed = transitionMutationApproval(latest, {
        type: 'fail',
        failure: {
          schemaVersion: 1,
          code: error instanceof MutationPatchExecutionError ? error.code : 'write-failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: error instanceof MutationPatchExecutionError ? error.retryable : false,
        },
      });
      this.records.set(failed.approvalId, failed);
      this.approvals.writeToolAudit({
        requestId: failed.requestId,
        toolName: 'patch.apply',
        action: 'approved patch execution failed',
        args: approvalArgs(current.value.request),
        status: 'failed',
        paths: failed.affectedPaths,
      });
      this.emitChanged();
      return toMutationApprovalRendererView(failed);
    }
  }

  snapshot(): MutationApprovalQueueSnapshot {
    this.expirePending();
    const approvals = this.sortedRecords().map(toMutationApprovalRendererView);
    return {
      schemaVersion: 1,
      approvals,
      pendingCount: approvals.filter((approval) => approval.status === 'pending').length,
    };
  }

  dispose(reason = 'runtime-disposed'): void {
    if (this.disposed) return;
    for (const record of this.records.values()) {
      if (record.status !== 'pending' && record.status !== 'applying') continue;
      const cancelled = transitionMutationApproval(record, {
        type: 'cancel',
        failure: {
          schemaVersion: 1,
          code: 'cancelled',
          message: reason,
          retryable: true,
        },
      });
      this.records.set(cancelled.approvalId, cancelled);
      this.approvals.updateApprovalStatus(cancelled.approvalId, 'cancelled');
    }
    this.disposed = true;
    this.emitChanged();
  }

  private markStale(record: MutationApprovalRecord): MutationApprovalRendererView {
    if (record.status !== 'pending') {
      throw new MutationApprovalRuntimeError('invalid-state', `Approval is not pending: ${record.status}.`);
    }
    const stale = transitionMutationApproval(record, {
      type: 'mark-stale',
      failure: {
        schemaVersion: 1,
        code: 'approval-stale',
        message: 'The target or preview changed after the approval was created.',
        retryable: true,
      },
    });
    this.records.set(stale.approvalId, stale);
    this.approvals.updateApprovalStatus(stale.approvalId, 'stale');
    this.emitChanged();
    return toMutationApprovalRendererView(stale);
  }

  private expirePending(): void {
    const nowMs = this.now().getTime();
    let changed = false;
    for (const record of this.records.values()) {
      if (record.status !== 'pending' || Date.parse(record.expiresAt) > nowMs) continue;
      const expired = transitionMutationApproval(record, { type: 'expire' });
      this.records.set(expired.approvalId, expired);
      this.approvals.updateApprovalStatus(expired.approvalId, 'expired');
      changed = true;
    }
    if (changed) this.emitChanged();
  }

  private trimHistory(): void {
    if (this.records.size < MUTATION_APPROVAL_LIMITS.historyRecords) return;
    const removable = this.sortedRecords()
      .reverse()
      .filter((record) => record.status !== 'pending' && record.status !== 'applying');
    while (this.records.size >= MUTATION_APPROVAL_LIMITS.historyRecords && removable.length > 0) {
      const record = removable.shift()!;
      this.records.delete(record.approvalId);
      this.idempotencyIndex.delete(record.idempotencyKey);
    }
    if (this.records.size >= MUTATION_APPROVAL_LIMITS.historyRecords) {
      throw new MutationApprovalRuntimeError(
        'history-limit',
        `At most ${MUTATION_APPROVAL_LIMITS.historyRecords} approval records may be retained.`,
      );
    }
  }

  private pendingCount(): number {
    return Array.from(this.records.values()).filter((record) => record.status === 'pending').length;
  }

  private sortedRecords(): MutationApprovalRecord[] {
    return Array.from(this.records.values()).sort((left, right) => {
      const leftPending = left.status === 'pending' || left.status === 'applying';
      const rightPending = right.status === 'pending' || right.status === 'applying';
      if (leftPending !== rightPending) return leftPending ? -1 : 1;
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
  }

  private requireRecord(approvalId: string): MutationApprovalRecord {
    const record = this.records.get(approvalId);
    if (!record) throw new MutationApprovalRuntimeError('not-found', 'Approval request was not found.');
    return record;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new MutationApprovalRuntimeError('runtime-disposed', 'The approval runtime is no longer active.');
    }
  }

  private emitChanged(): void {
    if (!this.onChanged) return;
    try {
      this.onChanged(this.snapshotWithoutExpiry());
    } catch {
      // A renderer notification failure must not change approval state.
    }
  }

  private snapshotWithoutExpiry(): MutationApprovalQueueSnapshot {
    const approvals = this.sortedRecords().map(toMutationApprovalRendererView);
    return {
      schemaVersion: 1,
      approvals,
      pendingCount: approvals.filter((approval) => approval.status === 'pending').length,
    };
  }
}

function canonicalProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new MutationApprovalRuntimeError('invalid-project', 'The selected project root is not a directory.');
  }
  return fs.realpathSync.native(resolved);
}

function approvalArgs(request: PatchApplyProposalRequest): JsonObject {
  return { patch: request.patch as unknown as JsonObject };
}

function safeValidationMessage(errors: string[], projectRoot: string): string {
  const normalizedRoot = path.resolve(projectRoot);
  const safe = errors
    .slice(0, 5)
    .map((error) => error.split(normalizedRoot).join('[project]'));
  return `The patch proposal is invalid: ${safe.join('; ')}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf-8');
  const rightBuffer = Buffer.from(right, 'utf-8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
