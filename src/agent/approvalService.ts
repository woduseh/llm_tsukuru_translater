import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ApprovalRequest, JsonObject, PermissionTier } from '../types/agentWorkspace';
import { redactSecretLikeValues } from './contractsValidation';
import { AgentEventBus } from './eventBus';

export interface AgentTransactionPlan {
  schemaVersion: 1;
  transactionId: string;
  createdAt: string;
  title: string;
  summary: string;
  affectedPaths: string[];
  previewArtifactPath?: string;
  permissionTier: Exclude<PermissionTier, 'readonly'>;
  approvalId?: string;
}

export interface ApprovalServiceOptions {
  eventBus: AgentEventBus;
  idFactory?: () => string;
  tokenFactory?: () => string;
  now?: () => Date;
  sessionId?: string;
  auditRoot?: string;
}

export interface ApprovalPlanInput {
  requestId: string;
  toolName: string;
  permissionTier: Exclude<PermissionTier, 'readonly'>;
  reason: string;
  planOperation: string;
  affectedPaths: string[];
  args: JsonObject;
  previewArtifactPath?: string;
  previewRef?: string;
  ttlMs?: number;
  sessionId?: string;
}

export interface ApprovalExecutionInput {
  toolName: string;
  args: JsonObject;
  confirmToken?: string;
  sessionId?: string;
}

export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;
  private readonly now: () => Date;
  private readonly sessionId: string;
  private readonly auditPath: string;

  constructor(private readonly options: ApprovalServiceOptions) {
    this.idFactory = options.idFactory ?? (() => `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    this.tokenFactory = options.tokenFactory ?? (() => `confirm-${crypto.randomBytes(18).toString('base64url')}`);
    this.now = options.now ?? (() => new Date());
    this.sessionId = options.sessionId ?? 'local-session';
    this.auditPath = path.join(options.auditRoot ?? options.eventBus.workspaceRoot, 'audit', 'approvals.jsonl');
  }

  createTransactionPlan(input: Omit<AgentTransactionPlan, 'schemaVersion' | 'transactionId' | 'createdAt'> & { transactionId?: string }): AgentTransactionPlan {
    return {
      schemaVersion: 1,
      transactionId: input.transactionId ?? `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: this.now().toISOString(),
      title: input.title,
      summary: input.summary,
      affectedPaths: input.affectedPaths,
      previewArtifactPath: input.previewArtifactPath,
      permissionTier: input.permissionTier,
      approvalId: input.approvalId,
    };
  }

  planApproval(input: ApprovalPlanInput): ApprovalRequest {
    const approval = this.requestApproval({
      requestId: input.requestId,
      toolName: input.toolName,
      permissionTier: input.permissionTier,
      reason: input.reason,
      planOperation: input.planOperation,
      affectedPaths: input.affectedPaths,
      argsHash: hashArgs(input.args),
      previewArtifactPath: input.previewArtifactPath,
      previewRef: input.previewRef,
      ttlMs: input.ttlMs,
      sessionId: input.sessionId ?? this.sessionId,
    });
    this.writeAudit('approval-requested', approval, input.args, 'needs-approval');
    return approval;
  }

  requestApproval(input: {
    requestId: string;
    toolName: string;
    permissionTier: Exclude<PermissionTier, 'readonly'>;
    reason: string;
    planOperation?: string;
    affectedPaths: string[];
    argsHash?: string;
    previewArtifactPath?: string;
    previewRef?: string;
    ttlMs?: number;
    sessionId?: string;
  }): ApprovalRequest {
    const confirmToken = this.tokenFactory();
    const approval: ApprovalRequest = {
      schemaVersion: 1,
      approvalId: this.idFactory(),
      requestId: input.requestId,
      toolName: input.toolName,
      permissionTier: input.permissionTier,
      reason: input.reason,
      planOperation: input.planOperation,
      affectedPaths: input.affectedPaths,
      argsHash: input.argsHash,
      previewArtifactPath: input.previewArtifactPath,
      previewRef: input.previewRef,
      confirmToken,
      sessionId: input.sessionId ?? this.sessionId,
      expiresAt: new Date(this.now().getTime() + (input.ttlMs ?? 15 * 60 * 1000)).toISOString(),
      status: 'pending',
    };
    this.approvals.set(approval.approvalId, approval);
    this.tokenIndex.set(confirmToken, approval.approvalId);
    this.options.eventBus.emit({ kind: 'approval', approval });
    return approval;
  }

  consumeConfirmation(input: ApprovalExecutionInput): ApprovalRequest {
    if (!input.confirmToken) throw new Error('Approval confirmToken is required.');
    const approvalId = this.tokenIndex.get(input.confirmToken);
    if (!approvalId) throw new Error('Approval confirmToken is invalid or already used.');
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error('Approval record is missing.');
    if (approval.toolName !== input.toolName) throw new Error('Approval toolName mismatch.');
    if (approval.sessionId !== (input.sessionId ?? this.sessionId)) throw new Error('Approval session mismatch.');
    if (approval.status === 'denied') throw new Error('Approval was denied.');
    if (approval.status !== 'pending') throw new Error(`Approval is not pending: ${approval.status}.`);
    if (new Date(approval.expiresAt).getTime() <= this.now().getTime()) {
      approval.status = 'expired';
      this.tokenIndex.delete(input.confirmToken);
      this.options.eventBus.emit({ kind: 'approval', approval });
      this.writeAudit('approval-expired', approval, input.args, 'failed');
      throw new Error('Approval has expired.');
    }
    const argsHash = hashArgs(input.args);
    if (approval.argsHash && approval.argsHash !== argsHash) {
      this.writeAudit('approval-args-mismatch', approval, input.args, 'failed');
      throw new Error('Approval args hash mismatch.');
    }
    approval.status = 'granted';
    this.tokenIndex.delete(input.confirmToken);
    this.options.eventBus.emit({ kind: 'approval', approval });
    this.writeAudit('approval-consumed', approval, input.args, 'ok');
    return approval;
  }

  updateApprovalStatus(approvalId: string, status: ApprovalRequest['status']): ApprovalRequest | undefined {
    const approval = this.approvals.get(approvalId);
    if (!approval) return undefined;
    approval.status = status;
    if (status !== 'pending' && approval.confirmToken) this.tokenIndex.delete(approval.confirmToken);
    this.options.eventBus.emit({ kind: 'approval', approval });
    this.writeAudit(`approval-${status}`, approval, {}, status === 'denied' || status === 'expired' ? 'failed' : 'ok');
    return approval;
  }

  getApproval(approvalId: string): ApprovalRequest | undefined {
    return this.approvals.get(approvalId);
  }

  writeToolAudit(input: { requestId: string; toolName: string; action: string; args: JsonObject; status: 'ok' | 'failed' | 'needs-approval'; paths?: string[] }): void {
    this.appendAudit({
      schemaVersion: 1,
      timestamp: this.now().toISOString(),
      kind: 'tool-call',
      requestId: input.requestId,
      toolName: input.toolName,
      action: input.action,
      status: input.status,
      paths: input.paths ?? [],
      args: redactSecretLikeValues(input.args).value,
      argsHash: hashArgs(input.args),
    });
  }

  private writeAudit(action: string, approval: ApprovalRequest, args: JsonObject, status: string): void {
    const redactedApproval = {
      ...approval,
      ...(approval.confirmToken ? { confirmToken: '[REDACTED]' } : {}),
    } as unknown as JsonObject;
    this.appendAudit({
      schemaVersion: 1,
      timestamp: this.now().toISOString(),
      kind: 'approval',
      action,
      status,
      approval: redactedApproval,
      args: redactSecretLikeValues(args).value,
      argsHash: hashArgs(args),
    });
  }

  private appendAudit(entry: JsonObject): void {
    fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
    fs.appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }
}

export function hashArgs(args: JsonObject): string {
  return crypto.createHash('sha256').update(stableStringify(args)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
