import type { AgentResultEnvelope, JsonObject, McpToolDefinition, PermissionTier } from '../types/agentWorkspace';
import { redactSecretLikeValues } from './contractsValidation';

export type MockToolHandler = (input: JsonObject, context: MockMcpContext) => JsonObject;

export interface MockMcpContext {
  requestId: string;
  previousResults: AgentResultEnvelope[];
}

interface RegisteredMockTool {
  definition: McpToolDefinition;
  handler: MockToolHandler;
}

export class MockMcpServer {
  private readonly tools = new Map<string, RegisteredMockTool>();

  constructor() {
    this.registerTool({
      name: 'project.context_snapshot',
      title: 'Project context snapshot',
      description: 'Returns placeholder project context for golden workflows.',
      permissionTier: 'readonly',
      inputSchema: { type: 'object' },
    }, (input) => ({
      projectId: stringOrDefault(input.projectId, 'mock-project'),
      engine: 'rpg-maker-mock',
      files: ['data/Map001.json', 'Extract/Map001.txt'],
      qualityRules: ['line-alignment', 'separator-preservation'],
    }));

    this.registerTool({
      name: 'project.translation_inventory',
      title: 'Translation inventory',
      description: 'Returns placeholder translation inventory.',
      permissionTier: 'readonly',
      inputSchema: { type: 'object' },
    }, () => ({
      textFiles: [{ path: 'Extract/Map001.txt', lines: 7, hasControlCodes: true }],
      separators: ['--- 101 ---'],
      emptyLineCount: 1,
    }));

    this.registerTool({
      name: 'quality.review_batch',
      title: 'Quality review batch',
      description: 'Returns placeholder quality review findings.',
      permissionTier: 'readonly',
      inputSchema: { type: 'object' },
    }, () => ({
      batchId: 'mock-review-batch',
      findings: [{ severity: 'info', code: 'placeholder-review', message: 'Mock review completed.' }],
      approvedForApply: false,
    }));
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  registerTool(definition: McpToolDefinition, handler: MockToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  callTool(name: string, input: JsonObject = {}, previousResults: AgentResultEnvelope[] = []): AgentResultEnvelope {
    const requestId = `req-${previousResults.length + 1}-${name}`;
    const tool = this.tools.get(name);
    if (!tool) {
      return createFailureEnvelope(requestId, name, 'readonly', `Unknown mock MCP tool: ${name}`);
    }
    try {
      const payload = tool.handler(input, { requestId, previousResults });
      const redacted = redactSecretLikeValues(payload);
      return {
        schemaVersion: 1,
        requestId,
        toolName: name,
        status: 'ok',
        permissionTier: tool.definition.permissionTier,
        payload: redacted.value as JsonObject,
        audit: [{
          schemaVersion: 1,
          auditId: `audit-${requestId}`,
          timestamp: new Date().toISOString(),
          kind: 'tool-call',
          actor: 'mcp',
          action: `mock call ${name}`,
          permissionTier: tool.definition.permissionTier,
          requestId,
        }],
        redactions: redacted.redactions,
      };
    } catch (error) {
      return createFailureEnvelope(requestId, name, tool.definition.permissionTier, error instanceof Error ? error.message : String(error));
    }
  }
}

export class MockMcpClient {
  constructor(private readonly server: MockMcpServer) {}

  listTools(): McpToolDefinition[] {
    return this.server.listTools();
  }

  callTool(name: string, input: JsonObject = {}, previousResults: AgentResultEnvelope[] = []): AgentResultEnvelope {
    return this.server.callTool(name, input, previousResults);
  }
}

function createFailureEnvelope(requestId: string, toolName: string, permissionTier: PermissionTier, message: string): AgentResultEnvelope {
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
      stage: 'mock-mcp-call',
      message,
      retryable: false,
      createdAt: new Date().toISOString(),
    },
    audit: [{
      schemaVersion: 1,
      auditId: `audit-${requestId}`,
      timestamp: new Date().toISOString(),
      kind: 'failure',
      actor: 'mcp',
      action: message,
      permissionTier,
      requestId,
    }],
    redactions: [],
  };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
