import * as path from 'path';
import type { AgentService } from '../agent/agentService';
import { hashArgs } from '../agent/approvalService';
import type { GlossaryCreateInput } from '../agent/glossaryService';
import type { AgentResultEnvelope, AuditEntry, JsonObject, McpToolDefinition, PermissionTier, TranslationPatch } from '../types/agentWorkspace';
import type { AppSettings } from '../types/settings';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import { redactSecretLikeValues } from '../agent/contractsValidation';
import { createMcpReadonlyToolRegistry, McpReadonlyToolRegistry } from './readonlyTools';

type MutationHandler = (args: JsonObject, context: MutationToolContext) => AgentResultEnvelope;

interface MutationToolContext {
  requestId: string;
  service: AgentService;
  sessionId?: string;
}

interface RegisteredMutationTool {
  definition: McpToolDefinition;
  handler: MutationHandler;
}

export class McpMutationToolRegistry {
  private readonly readonlyRegistry: McpReadonlyToolRegistry;
  private readonly mutationTools = new Map<string, RegisteredMutationTool>();

  constructor(
    private readonly service: AgentService,
    private readonly options: { settings?: Partial<AppSettings> & Record<string, unknown>; sessionId?: string } = {},
  ) {
    this.readonlyRegistry = createMcpReadonlyToolRegistry(service, { settings: options.settings });
  }

  register(definition: McpToolDefinition, handler: MutationHandler): void {
    if (definition.permissionTier === 'readonly') throw new Error(`Mutation registry tool ${definition.name} must not be readonly.`);
    this.mutationTools.set(definition.name, { definition, handler });
  }

  listTools(): McpToolDefinition[] {
    return [...this.readonlyRegistry.listTools(), ...Array.from(this.mutationTools.values()).map((tool) => tool.definition)];
  }

  callTool(name: string, args: JsonObject = {}, requestId = createRequestId(name)): AgentResultEnvelope {
    const mutationTool = this.mutationTools.get(name);
    if (!mutationTool) return this.readonlyRegistry.callTool(name, args, requestId);
    try {
      return mutationTool.handler(args, { requestId, service: this.service, sessionId: this.options.sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.service.approvals.writeToolAudit({ requestId, toolName: name, action: `call ${name}`, args: stripApprovalArgs(args), status: 'failed' });
      return failureEnvelope(requestId, name, mutationTool.definition.permissionTier, message);
    }
  }
}

export function createMcpMutationToolRegistry(
  service: AgentService,
  options: { settings?: Partial<AppSettings> & Record<string, unknown>; sessionId?: string } = {},
): McpMutationToolRegistry {
  const registry = new McpMutationToolRegistry(service, options);
  for (const tool of createMutationToolDefinitions()) registry.register(tool.definition, tool.handler);
  return registry;
}

export function createMutationToolDefinitions(): RegisteredMutationTool[] {
  return [
    {
      definition: mutationDefinition('patch.apply', 'Apply approved patch', 'Applies a valid same-line-count translation patch only after exact args approval.'),
      handler: (args, context) => {
        const patch = requirePatch(args);
        const approvedArgs = stripApprovalArgs(args);
        const preview = context.service.patch.preview(patch);
        if (args.dryRun === true) return okEnvelope(context.requestId, 'patch.apply', 'approval-required', { dryRunOnly: true, preview } as unknown as JsonObject);
        const artifact = context.service.artifacts.writeJsonArtifact('approval-preview', `${context.requestId}-patch-apply`, { toolName: 'patch.apply', preview } as unknown as JsonObject);
        const approval = approveOrConsume(args, context, 'patch.apply', approvedArgs, {
          reason: 'patch.apply can modify a translation text file.',
          planOperation: 'apply same-line-count translation patch',
          affectedPaths: [patch.targetPath],
          previewArtifactPath: artifact.path,
        });
        if (approval) return approval;
        const result = context.service.patch.apply(patch) as unknown as JsonObject;
        context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName: 'patch.apply', action: 'applied approved patch', args: approvedArgs, status: 'ok', paths: [patch.targetPath] });
        return okEnvelope(context.requestId, 'patch.apply', 'approval-required', result);
      },
    },
    {
      definition: mutationDefinition('styleguide.apply_patch', 'Apply workspace styleguide patch', 'Writes a bounded styleguide record under .llm-tsukuru-agent only after approval.'),
      handler: (args, context) => styleguideApply(args, context),
    },
    {
      definition: mutationDefinition('guideline.apply_patch', 'Apply workspace guideline patch', 'Alias for styleguide.apply_patch; writes only workspace guideline metadata after approval.'),
      handler: (args, context) => styleguideApply(args, context, 'guideline.apply_patch'),
    },
    {
      definition: mutationDefinition('glossary.apply_entries', 'Apply glossary entries', 'Persists approved entries to the workspace glossary DB with secret redaction.'),
      handler: (args, context) => {
        const entries = requireEntries(args);
        const approvedArgs = stripApprovalArgs(args);
        if (args.dryRun === true) return okEnvelope(context.requestId, 'glossary.apply_entries', 'approval-required', { dryRunOnly: true, entriesPlanned: entries.length } as unknown as JsonObject);
        const artifact = context.service.artifacts.writeJsonArtifact('approval-preview', `${context.requestId}-glossary`, { entries } as unknown as JsonObject);
        const approval = approveOrConsume(args, context, 'glossary.apply_entries', approvedArgs, {
          reason: 'glossary.apply_entries updates the project-local workspace glossary.',
          planOperation: 'persist workspace glossary entries',
          affectedPaths: ['.llm-tsukuru-agent\\glossary\\entries.json'],
          previewArtifactPath: artifact.path,
        });
        if (approval) return approval;
        const applied = entries.map((entry) => context.service.glossary.createEntry(entry).entry);
        context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName: 'glossary.apply_entries', action: 'applied approved glossary entries', args: approvedArgs, status: 'ok', paths: ['.llm-tsukuru-agent\\glossary\\entries.json'] });
        return okEnvelope(context.requestId, 'glossary.apply_entries', 'approval-required', { applied } as unknown as JsonObject);
      },
    },
    {
      definition: mutationDefinition('job.abort', 'Abort job scaffold', 'Cancels a durable agent job after approval; no external processes are killed.'),
      handler: (args, context) => {
        const jobId = stringArg(args.jobId, 'job.abort requires jobId.');
        const approvedArgs = stripApprovalArgs(args);
        const approval = approveOrConsume(args, context, 'job.abort', approvedArgs, {
          reason: 'job.abort changes durable job state.',
          planOperation: 'cancel durable agent job state',
          affectedPaths: [`.llm-tsukuru-agent\\jobs\\${jobId}.json`],
        });
        if (approval) return approval;
        const job = context.service.jobs.updateStatus(jobId, 'cancelled', 'aborted by approved MCP tool') as unknown as JsonObject;
        context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName: 'job.abort', action: 'aborted approved job', args: approvedArgs, status: 'ok' });
        return okEnvelope(context.requestId, 'job.abort', 'approval-required', job);
      },
    },
    {
      definition: mutationDefinition('harness.run', 'Plan or run deterministic harness', 'Returns a dry-run harness command plan; approved execution remains fixture-safe and non-destructive.'),
      handler: (args, context) => harnessRun(args, context),
    },
    plannedUnavailableDefinition('translate.run', 'Plan translation execution', 'Translation execution is scaffolded as approval-gated dry-run planning only.'),
    plannedUnavailableDefinition('apply.run', 'Plan game apply execution', 'Game apply execution is scaffolded as approval-gated dry-run planning only.'),
    plannedUnavailableDefinition('checkpoint.create', 'Plan checkpoint creation', 'Checkpoint creation scaffold returns an approval preview only until checkpoint storage is implemented.'),
  ];
}

function styleguideApply(args: JsonObject, context: MutationToolContext, toolName = 'styleguide.apply_patch'): AgentResultEnvelope {
  const approvedArgs = stripApprovalArgs(args);
  const payload = typeof args.patch === 'object' && args.patch !== null ? args.patch as JsonObject : { text: String(args.text ?? '') };
  const targetRel = '.llm-tsukuru-agent\\mcp\\styleguide.json';
  if (args.dryRun === true) return okEnvelope(context.requestId, toolName, 'approval-required', { dryRunOnly: true, targetPath: targetRel, patch: payload });
  const artifact = context.service.artifacts.writeJsonArtifact('approval-preview', `${context.requestId}-styleguide`, { targetPath: targetRel, patch: payload });
  const approval = approveOrConsume(args, context, toolName, approvedArgs, {
    reason: `${toolName} updates workspace style/guideline metadata.`,
    planOperation: 'write workspace styleguide metadata',
    affectedPaths: [targetRel],
    previewArtifactPath: artifact.path,
  });
  if (approval) return approval;
  const target = path.join(context.service.descriptor.workspaceRoot, 'mcp', 'styleguide.json');
  atomicWriteJsonFile(target, { schemaVersion: 1, updatedAt: new Date().toISOString(), patch: payload }, 2);
  context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName, action: 'applied approved styleguide patch', args: approvedArgs, status: 'ok', paths: [targetRel] });
  return okEnvelope(context.requestId, toolName, 'approval-required', { applied: true, targetPath: targetRel });
}

function harnessRun(args: JsonObject, context: MutationToolContext): AgentResultEnvelope {
  const suite = stringArg(args.suite ?? 'core', 'harness.run suite must be a string.');
  const script = suite === 'core' ? 'npm run harness:core' : undefined;
  const plan = {
    dryRunOnly: args.execute !== true,
    suite,
    command: script ?? null,
    executable: Boolean(script),
    note: script ? 'Deterministic harness command is available; approved scaffold does not run destructive project operations.' : 'Only harness:core is enabled by this scaffold.',
  };
  const approvedArgs = stripApprovalArgs(args);
  if (args.dryRun !== false || args.execute !== true) return okEnvelope(context.requestId, 'harness.run', 'approval-required', plan);
  const approval = approveOrConsume(args, context, 'harness.run', approvedArgs, {
    reason: 'harness.run may execute a local deterministic command.',
    planOperation: 'run deterministic harness command',
    affectedPaths: ['artifacts\\harness'],
  });
  if (approval) return approval;
  const job = context.service.jobs.createJob({ kind: 'harness.run', title: `Harness ${suite}`, permissionTier: 'approval-required', input: { suite, command: script ?? '' } });
  context.service.jobs.updateStatus(job.jobId, 'completed', 'approved harness scaffold completed without spawning a process');
  context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName: 'harness.run', action: 'completed approved harness scaffold', args: approvedArgs, status: 'ok' });
  return okEnvelope(context.requestId, 'harness.run', 'approval-required', { ...plan, executed: false, jobId: job.jobId });
}

function plannedUnavailableDefinition(name: string, title: string, description: string): RegisteredMutationTool {
  return {
    definition: mutationDefinition(name, title, description),
    handler: (args, context) => {
      const approvedArgs = stripApprovalArgs(args);
      const artifact = context.service.artifacts.writeJsonArtifact('approval-preview', `${context.requestId}-${name.replace('.', '-')}`, {
        toolName: name,
        args: approvedArgs,
        available: false,
        dryRunOnly: true,
      } as unknown as JsonObject);
      const approval = approveOrConsume(args, context, name, approvedArgs, {
        reason: `${name} is too risky for direct execution in this scaffold.`,
        planOperation: 'planned unavailable execution scaffold',
        affectedPaths: [],
        previewArtifactPath: artifact.path,
      });
      if (approval) return approval;
      context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName: name, action: 'approved unavailable scaffold', args: approvedArgs, status: 'ok' });
      return okEnvelope(context.requestId, name, 'approval-required', { available: false, requiresManualAppWorkflow: true, dryRunOnly: true });
    },
  };
}

function approveOrConsume(
  args: JsonObject,
  context: MutationToolContext,
  toolName: string,
  approvedArgs: JsonObject,
  plan: { reason: string; planOperation: string; affectedPaths: string[]; previewArtifactPath?: string },
): AgentResultEnvelope | undefined {
  if (typeof args.confirmToken !== 'string' || args.confirmToken.trim() === '') {
    const approval = context.service.approvals.planApproval({
      requestId: context.requestId,
      toolName,
      permissionTier: 'approval-required',
      reason: plan.reason,
      planOperation: plan.planOperation,
      affectedPaths: plan.affectedPaths,
      args: approvedArgs,
      previewArtifactPath: plan.previewArtifactPath,
      sessionId: context.sessionId,
    });
    context.service.approvals.writeToolAudit({ requestId: context.requestId, toolName, action: `approval required for ${toolName}`, args: approvedArgs, status: 'needs-approval', paths: plan.affectedPaths });
    return needsApprovalEnvelope(context.requestId, toolName, approval, {
      argsHash: hashArgs(approvedArgs),
      ...(plan.previewArtifactPath ? { previewArtifactPath: plan.previewArtifactPath } : {}),
    });
  }
  context.service.approvals.consumeConfirmation({ toolName, args: approvedArgs, confirmToken: args.confirmToken, sessionId: context.sessionId });
  return undefined;
}

function mutationDefinition(name: string, title: string, description: string): McpToolDefinition {
  return {
    name,
    title,
    description,
    permissionTier: 'approval-required',
    inputSchema: { type: 'object', additionalProperties: true },
  };
}

function okEnvelope(requestId: string, toolName: string, permissionTier: PermissionTier, payload: JsonObject): AgentResultEnvelope {
  const redacted = redactSecretLikeValues(payload);
  return {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'ok',
    permissionTier,
    payload: redacted.value,
    audit: [auditEntry(requestId, toolName, permissionTier, 'tool-call', `call ${toolName}`)],
    redactions: redacted.redactions,
  };
}

function needsApprovalEnvelope(requestId: string, toolName: string, approvalRequest: AgentResultEnvelope['approvalRequest'], payload: JsonObject): AgentResultEnvelope {
  const redacted = redactSecretLikeValues(payload);
  return {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'needs-approval',
    permissionTier: 'approval-required',
    payload: redacted.value,
    approvalRequest,
    audit: [auditEntry(requestId, toolName, 'approval-required', 'approval', `approval required for ${toolName}`)],
    redactions: redacted.redactions,
  };
}

function failureEnvelope(requestId: string, toolName: string, permissionTier: PermissionTier, message: string): AgentResultEnvelope {
  const redacted = redactSecretLikeValues({ message });
  return {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'failed',
    permissionTier,
    failure: {
      schemaVersion: 1,
      failureId: `failure-${requestId}`,
      requestId,
      stage: 'mcp-mutation-tool',
      message: String(redacted.value.message),
      retryable: false,
      createdAt: new Date().toISOString(),
    },
    audit: [auditEntry(requestId, toolName, permissionTier, 'failure', String(redacted.value.message))],
    redactions: redacted.redactions,
  };
}

function auditEntry(requestId: string, toolName: string, permissionTier: PermissionTier, kind: AuditEntry['kind'], action: string): AuditEntry {
  return {
    schemaVersion: 1,
    auditId: `audit-${requestId}`,
    timestamp: new Date().toISOString(),
    kind,
    actor: 'mcp',
    action,
    permissionTier,
    requestId,
    metadata: { toolName },
  };
}

function requirePatch(args: JsonObject): TranslationPatch {
  if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) throw new Error('patch.apply requires patch object.');
  return args.patch as unknown as TranslationPatch;
}

function requireEntries(args: JsonObject): GlossaryCreateInput[] {
  if (!Array.isArray(args.entries)) throw new Error('glossary.apply_entries requires entries array.');
  return args.entries as unknown as GlossaryCreateInput[];
}

function stringArg(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
  return value;
}

function stripApprovalArgs(args: JsonObject): JsonObject {
  const { confirmToken: _confirmToken, ...rest } = args;
  return rest;
}

function createRequestId(name: string): string {
  return `mcp-${name.replace(/[^A-Za-z0-9_.-]+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
