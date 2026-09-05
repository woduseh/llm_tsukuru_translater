import * as crypto from 'crypto';
import type {
  AgentResultEnvelope,
  ApprovalRequest,
  AuditEntry,
  JsonObject,
  McpToolDefinition,
} from '../types/agentWorkspace';
import type { AgentBridgePatchApplyRequest } from '../agent/agentBridgeContracts';
import { redactSecretLikeValues } from '../agent/contractsValidation';
import {
  createSafeRecipePayload,
  createTranslationWorkflowPayload,
  explainTool,
  type AgentSkillGuideTopic,
} from '../agent/agentSkillGuide';
import {
  AgentBridgeClient,
  AgentBridgeClientError,
} from './agentBridgeClient';
import type { McpToolRegistryLike } from './mcpStdioServer';
import { PATCH_VALIDATE_INPUT_SCHEMA, validateToolArguments } from './readonlyTools';

const BRIDGE_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'patch.apply',
    title: 'Request patch approval',
    description: 'Submits one bounded translation patch to the running app for explicit user approval. Never writes directly.',
    permissionTier: 'approval-required',
    inputSchema: { ...PATCH_VALIDATE_INPUT_SCHEMA, properties: {
      ...(PATCH_VALIDATE_INPUT_SCHEMA.properties as JsonObject),
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$', description: 'Reuse the same key when retrying an uncertain submission. Prefer the patchId. A changed proposal needs a new key.' },
    } },
  },
  {
    name: 'approval.status',
    title: 'Get approval status',
    description: 'Reads the sanitized status and terminal result of one app approval request.',
    permissionTier: 'readonly',
    inputSchema: {
      type: 'object',
      properties: { approvalId: { type: 'string' } },
      required: ['approvalId'],
      additionalProperties: false,
    },
  },
  {
    name: 'bridge.status', title: 'Check live app bridge',
    description: 'Probe the authenticated app connection before submitting. Reports current availability and patch limits without creating an approval. A later call can still fail if the app closes.',
    permissionTier: 'readonly', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export interface AsyncMcpToolRegistryLike {
  listTools(): McpToolDefinition[];
  callTool(
    name: string,
    args?: JsonObject,
    requestId?: string,
  ): AgentResultEnvelope | Promise<AgentResultEnvelope>;
}

export class BridgeAwareMcpToolRegistry implements AsyncMcpToolRegistryLike {
  constructor(
    private readonly offlineRegistry: McpToolRegistryLike,
    private readonly options: { manifestPath: string; projectRoot: string },
  ) {}

  listTools(): McpToolDefinition[] {
    const names = new Set(BRIDGE_TOOL_DEFINITIONS.map((tool) => tool.name));
    return [
      ...this.offlineRegistry.listTools().filter((tool) => !names.has(tool.name)),
      ...BRIDGE_TOOL_DEFINITIONS,
    ];
  }

  async callTool(
    name: string,
    args: JsonObject = {},
    requestId = createFallbackRequestId(name),
  ): Promise<AgentResultEnvelope> {
    const definition = BRIDGE_TOOL_DEFINITIONS.find((tool) => tool.name === name);
    if (definition) {
      const errors = validateToolArguments(args, definition.inputSchema);
      if (errors.length) return failureEnvelope(requestId, name, errors.join('; '), false);
    }
    if (name === 'bridge.status') {
      try {
        const payload = await this.requireClient().getStatus();
        return { schemaVersion: 1, requestId, toolName: name, permissionTier: 'readonly', status: 'ok', payload, audit: [], redactions: [] };
      } catch (error) { return bridgeFailureEnvelope(requestId, name, error); }
    }
    if (name === 'patch.apply') return this.submitPatch(args, requestId);
    if (name === 'approval.status') return this.readApproval(args, requestId);
    const result = await this.offlineRegistry.callTool(name, args, requestId);
    // Retain argument validation and audit metadata while describing the full
    // registered surface, without probing or submitting to the app bridge.
    if (result.status === 'ok') {
      if (name === 'project.context_snapshot' && result.payload) {
        result.payload.availableTools = this.listTools().map((tool) => ({ name: tool.name, permissionTier: tool.permissionTier }));
      }
      if (name === 'help.explain_tool') {
        result.payload = explainTool(args.toolName as string, this.listTools());
      } else if (name === 'help.translation_workflow') {
        result.payload = createTranslationWorkflowPayload(this.listTools());
      } else if (name === 'help.safe_recipe') {
        result.payload = createSafeRecipePayload(args.recipeId as AgentSkillGuideTopic, this.listTools());
      }
      if (name.startsWith('help.') && result.payload) {
        const redacted = redactSecretLikeValues(result.payload);
        result.payload = redacted.value;
        result.redactions = [...result.redactions, ...redacted.redactions];
      }
    }
    return result;
  }

  private async submitPatch(args: JsonObject, requestId: string): Promise<AgentResultEnvelope> {
    if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) {
      return failureEnvelope(requestId, 'patch.apply', 'patch.apply requires a patch object.');
    }
    try {
      const request: AgentBridgePatchApplyRequest = {
        schemaVersion: 1,
        requestId,
        idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : requestId,
        toolName: 'patch.apply',
        patch: args.patch as unknown as AgentBridgePatchApplyRequest['patch'],
      };
      const result = await this.requireClient().submit(request);
      if (result.approval.status !== 'pending') {
        return {
          schemaVersion: 1, requestId, toolName: 'patch.apply', status: 'ok', permissionTier: 'approval-required',
          payload: { approvalId: result.approval.approvalId, status: result.approval.status,
            approval: result.approval as unknown as JsonObject, pollWith: 'approval.status',
            message: 'This submission already has a decision or is applying. No new approval was created.' },
          audit: [auditEntry(requestId, 'patch.apply', 'tool-call', 'read existing submission')], redactions: [],
        };
      }
      const approvalRequest: ApprovalRequest = {
        schemaVersion: 1,
        approvalId: result.approval.approvalId,
        requestId: result.approval.requestId,
        toolName: 'patch.apply',
        permissionTier: 'approval-required',
        reason: 'The running app requires an explicit user decision.',
        affectedPaths: result.approval.affectedPaths,
        expiresAt: result.approval.expiresAt,
        status: 'pending',
      };
      return {
        schemaVersion: 1,
        requestId,
        toolName: 'patch.apply',
        status: 'needs-approval',
        permissionTier: 'approval-required',
        payload: {
          approvalId: result.approval.approvalId,
          status: result.approval.status,
          pollWith: 'approval.status',
          message: 'Review this request in the app approval queue.',
        },
        approvalRequest,
        audit: [auditEntry(requestId, 'patch.apply', 'approval', 'submitted patch proposal')],
        redactions: [],
      };
    } catch (error) {
      return bridgeFailureEnvelope(requestId, 'patch.apply', error);
    }
  }

  private async readApproval(args: JsonObject, requestId: string): Promise<AgentResultEnvelope> {
    if (typeof args.approvalId !== 'string') {
      return failureEnvelope(requestId, 'approval.status', 'approval.status requires an approvalId.');
    }
    try {
      const result = await this.requireClient().getApproval(args.approvalId);
      return {
        schemaVersion: 1,
        requestId,
        toolName: 'approval.status',
        status: 'ok',
        permissionTier: 'readonly',
        payload: {
          status: result.status,
          approval: result.approval as unknown as JsonObject,
        },
        audit: [auditEntry(requestId, 'approval.status', 'tool-call', 'read approval status')],
        redactions: [],
      };
    } catch (error) {
      return bridgeFailureEnvelope(requestId, 'approval.status', error);
    }
  }

  private requireClient(): AgentBridgeClient {
    // Rebind only through the project-checked manifest, allowing app restart recovery.
    return AgentBridgeClient.fromManifest(this.options.manifestPath, this.options.projectRoot);
  }
}

export function createBridgeMcpRequestId(
  processSessionId: string,
  jsonRpcId: string | number | null | undefined,
): string {
  const digest = crypto.createHash('sha256')
    .update(`${processSessionId}:${String(jsonRpcId ?? 'notification')}`, 'utf-8')
    .digest('hex')
    .slice(0, 24);
  return `bridge-${digest}`;
}

function bridgeFailureEnvelope(
  requestId: string,
  toolName: string,
  error: unknown,
): AgentResultEnvelope {
  const bridgeError = error instanceof AgentBridgeClientError
    ? error
    : new AgentBridgeClientError('bridge-error', 'The bridge request failed safely.');
  return failureEnvelope(requestId, toolName, `${bridgeError.code}: ${bridgeError.message}`,
    ['bridge-timeout', 'bridge-unavailable', 'rate-limit'].includes(bridgeError.code));
}

function failureEnvelope(
  requestId: string,
  toolName: string,
  message: string,
  retryable = false,
): AgentResultEnvelope {
  return {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'failed',
    permissionTier: toolName === 'patch.apply' ? 'approval-required' : 'readonly',
    failure: {
      schemaVersion: 1,
      failureId: `failure-${requestId}`,
      requestId,
      stage: 'app-bridge',
      message,
      retryable,
      createdAt: new Date().toISOString(),
    },
    audit: [auditEntry(requestId, toolName, 'failure', `bridge call failed: ${toolName}`)],
    redactions: [],
  };
}

function auditEntry(
  requestId: string,
  toolName: string,
  kind: AuditEntry['kind'],
  action: string,
): AuditEntry {
  return {
    schemaVersion: 1,
    auditId: `audit-${requestId}`,
    timestamp: new Date().toISOString(),
    kind,
    actor: 'mcp',
    action,
    permissionTier: toolName === 'patch.apply' ? 'approval-required' : 'readonly',
    requestId,
    metadata: { toolName },
  };
}

function createFallbackRequestId(name: string): string {
  return `bridge-${name.replace(/[^A-Za-z0-9_.-]+/g, '-')}-${crypto.randomUUID()}`;
}
