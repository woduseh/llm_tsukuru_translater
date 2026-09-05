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

const BRIDGE_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'patch.apply',
    title: 'Request patch approval',
    description: 'Submits one bounded translation patch to the running app for explicit user approval. Never writes directly.',
    permissionTier: 'approval-required',
    inputSchema: {
      type: 'object',
      properties: { patch: { type: 'object' } },
      required: ['patch'],
      additionalProperties: false,
    },
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
  private readonly client?: AgentBridgeClient;
  private readonly clientError?: AgentBridgeClientError;

  constructor(
    private readonly offlineRegistry: McpToolRegistryLike,
    options: { manifestPath: string; projectRoot: string },
  ) {
    try {
      this.client = AgentBridgeClient.fromManifest(options.manifestPath, options.projectRoot);
    } catch (error) {
      this.clientError = error instanceof AgentBridgeClientError
        ? error
        : new AgentBridgeClientError('bridge-unavailable', 'The running app bridge is unavailable.');
    }
  }

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
    if (name === 'patch.apply') return this.submitPatch(args, requestId);
    if (name === 'approval.status') return this.readApproval(args, requestId);
    const result = await this.offlineRegistry.callTool(name, args, requestId);
    // Retain argument validation and audit metadata while describing the full
    // registered surface, without probing or submitting to the app bridge.
    if (result.status === 'ok') {
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
        idempotencyKey: requestId,
        toolName: 'patch.apply',
        patch: args.patch as unknown as AgentBridgePatchApplyRequest['patch'],
      };
      const result = await this.requireClient().submit(request);
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
    if (this.client) return this.client;
    throw this.clientError ?? new AgentBridgeClientError(
      'bridge-unavailable',
      'The running app bridge is unavailable.',
    );
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
  return failureEnvelope(requestId, toolName, `${bridgeError.code}: ${bridgeError.message}`);
}

function failureEnvelope(
  requestId: string,
  toolName: string,
  message: string,
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
      retryable: true,
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
