import type { JsonObject, JsonValue } from '../types/agentWorkspace';
import { McpReadonlyToolRegistry } from './readonlyTools';

export interface McpToolRegistryLike {
  listTools(): JsonValue[];
  callTool(name: string, args?: JsonObject, requestId?: string): JsonValue;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: JsonObject;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: JsonValue;
  error?: {
    code: number;
    message: string;
  };
}

export class ProtocolLightMcpServer {
  constructor(private readonly registry: McpReadonlyToolRegistry | McpToolRegistryLike) {}

  handle(request: JsonRpcRequest): JsonRpcResponse {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return errorResponse(null, -32600, 'Invalid JSON-RPC request.');
    }
    const id = request.id ?? null;
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: 'protocol-light',
          serverInfo: {
            name: 'llm-tsukuru-translater-mcp-readonly',
            version: 1,
            sdk: 'not-installed',
          },
          capabilities: { tools: { listChanged: false } },
        },
      };
    }
    if (request.method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: this.registry.listTools() as unknown as JsonValue } };
    }
    if (request.method === 'tools/call') {
      const params = request.params ?? {};
      if (typeof params.name !== 'string') return errorResponse(id, -32602, 'tools/call requires params.name.');
      const args = isJsonObject(params.arguments) ? params.arguments : {};
      const result = this.registry.callTool(params.name, args, typeof request.id === 'string' ? request.id : undefined);
      return { jsonrpc: '2.0', id, result: result as unknown as JsonValue };
    }
    return errorResponse(id, -32601, `Unsupported protocol-light method: ${request.method}`);
  }
}

export class ProtocolLightMcpClient {
  private nextId = 1;

  constructor(private readonly server: ProtocolLightMcpServer) {}

  initialize(): JsonRpcResponse {
    return this.send('initialize', {});
  }

  listTools(): JsonRpcResponse {
    return this.send('tools/list', {});
  }

  callTool(name: string, args: JsonObject = {}): JsonRpcResponse {
    return this.send('tools/call', { name, arguments: args });
  }

  send(method: string, params: JsonObject): JsonRpcResponse {
    return this.server.handle({ jsonrpc: '2.0', id: `mock-${this.nextId++}`, method, params });
  }
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
