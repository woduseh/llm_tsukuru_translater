import type { JsonObject } from '../types/agentWorkspace';
import {
  handleMcpRequest,
  type JsonRpcMessage as JsonRpcRequest,
  type JsonRpcResponse,
  type McpToolRegistryLike,
} from './mcpStdioServer';

export type { JsonRpcRequest, JsonRpcResponse, McpToolRegistryLike };

export class ProtocolLightMcpServer {
  constructor(private readonly registry: McpToolRegistryLike) {}

  handle(request: JsonRpcRequest): JsonRpcResponse | null {
    return handleMcpRequest(this.registry, request);
  }
}

export class ProtocolLightMcpClient {
  private nextId = 1;

  constructor(private readonly server: ProtocolLightMcpServer) {}

  initialize(): JsonRpcResponse {
    return this.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'protocol-light-test-client', version: '1' },
    });
  }

  listTools(): JsonRpcResponse {
    return this.send('tools/list', {});
  }

  callTool(name: string, args: JsonObject = {}): JsonRpcResponse {
    return this.send('tools/call', { name, arguments: args });
  }

  send(method: string, params: JsonObject): JsonRpcResponse {
    const response = this.server.handle({ jsonrpc: '2.0', id: `mock-${this.nextId++}`, method, params });
    if (!response) throw new Error(`Protocol notification ${method} did not return a response.`);
    return response;
  }
}
