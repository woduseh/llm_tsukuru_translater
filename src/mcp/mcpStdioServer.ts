/**
 * Spec-compliant Model Context Protocol (MCP) stdio server exposing the
 * project-protecting translation tools. Unlike protocolLight.ts (kept for the in-process
 * mock/tests), this speaks the real MCP handshake so external CLIs such as
 * Codex and Claude can connect to it.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout.
 * Scope: project reads plus analysis writes under .llm-tsukuru-agent/ (offline;
 * no connection to the running app is required).
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as readline from 'readline';
import { AgentService } from '../agent/agentService';
import {
  BridgeAwareMcpToolRegistry,
  createBridgeMcpRequestId,
  type AsyncMcpToolRegistryLike,
} from './bridgeTools';
import { createMcpOfflineToolRegistry } from './readonlyTools';
import type { AgentResultEnvelope, JsonObject, JsonValue, McpToolDefinition } from '../types/agentWorkspace';

export interface McpToolRegistryLike {
  listTools(): McpToolDefinition[];
  callTool(name: string, args?: JsonObject, requestId?: string): AgentResultEnvelope;
}

/** Protocol versions we understand, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'llm-tsukuru-translater', version: '1.0.0' };

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: JsonObject;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: JsonValue;
  error?: { code: number; message: string };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ok(id: string | number | null, result: JsonValue): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function err(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toMcpTool(def: McpToolDefinition): JsonObject {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: {
      readOnlyHint: def.permissionTier === 'readonly',
      destructiveHint: false,
    },
  };
}

/** Wrap our internal result envelope into the MCP tools/call content shape. */
export function toToolCallResult(envelope: AgentResultEnvelope): JsonObject {
  const isError = envelope.status === 'failed';
  const body = envelope.status === 'failed'
    ? (envelope.failure ?? { message: `Tool ${envelope.toolName} failed.` })
    : envelope.status === 'needs-approval'
      ? {
          status: envelope.status,
          payload: envelope.payload ?? {},
          approvalRequest: envelope.approvalRequest ?? {},
        }
      : (envelope.payload ?? {});
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    isError,
  };
}

/**
 * Pure request handler. Returns a JSON-RPC response, or null for notifications
 * (requests without an id) which must not be answered.
 */
export function handleMcpRequest(registry: McpToolRegistryLike, request: JsonRpcMessage): JsonRpcResponse | null {
  const isNotification = request == null || request.id === undefined;
  const id = request && request.id != null ? request.id : null;

  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return err(id, -32600, 'Invalid JSON-RPC request.');
  }

  switch (request.method) {
    case 'initialize': {
      const requested = typeof request.params?.protocolVersion === 'string' ? request.params.protocolVersion : '';
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: registry.listTools().map(toMcpTool) });
    case 'tools/call': {
      const name = request.params?.name;
      if (typeof name !== 'string') return err(id, -32602, 'tools/call requires a string params.name.');
      const args = isJsonObject(request.params?.arguments) ? (request.params!.arguments as JsonObject) : {};
      const envelope = registry.callTool(name, args);
      return ok(id, toToolCallResult(envelope));
    }
    default:
      // Notifications (initialized, cancelled, progress, ...) get no response.
      if (request.method.startsWith('notifications/') || isNotification) return null;
      return err(id, -32601, `Method not found: ${request.method}`);
  }
}

export async function handleMcpRequestAsync(
  registry: AsyncMcpToolRegistryLike,
  request: JsonRpcMessage,
  requestId?: string,
): Promise<JsonRpcResponse | null> {
  if (request?.method !== 'tools/call') {
    return handleMcpRequest(registry as McpToolRegistryLike, request);
  }
  const id = request.id != null ? request.id : null;
  const name = request.params?.name;
  if (typeof name !== 'string') return err(id, -32602, 'tools/call requires a string params.name.');
  const args = isJsonObject(request.params?.arguments) ? (request.params!.arguments as JsonObject) : {};
  const envelope = await registry.callTool(name, args, requestId);
  return ok(id, toToolCallResult(envelope));
}

export function runMcpStdioServer(
  projectRoot: string = process.cwd(),
  bridgeManifestPath?: string,
): void {
  const offlineRegistry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
  const registry: AsyncMcpToolRegistryLike = bridgeManifestPath
    ? new BridgeAwareMcpToolRegistry(offlineRegistry, { manifestPath: bridgeManifestPath, projectRoot })
    : offlineRegistry;
  const processSessionId = crypto.randomUUID();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void (async () => {
      let response: JsonRpcResponse | null;
      try {
        const request = JSON.parse(trimmed) as JsonRpcMessage;
        response = await handleMcpRequestAsync(
          registry,
          request,
          createBridgeMcpRequestId(processSessionId, request.id),
        );
      } catch (error) {
        response = err(null, -32700, error instanceof Error ? error.message : String(error));
      }
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    })();
  });
}

export function resolveMcpProjectRoot(
  argv: string[],
  moduleFilename: string,
  cwd: string,
): { projectRoot: string; bridgeManifestPath?: string } {
  const projectFlagIndex = argv.indexOf('--project');
  const manifestFlagIndex = argv.indexOf('--bridge-manifest');
  const bridgeManifestPath = manifestFlagIndex >= 0 ? argv[manifestFlagIndex + 1] : undefined;
  const projectRoot = projectFlagIndex >= 0 && argv[projectFlagIndex + 1]
    ? argv[projectFlagIndex + 1]
    : bridgeManifestPath
      ? path.dirname(path.dirname(path.resolve(moduleFilename)))
      : cwd;
  return {
    projectRoot: path.resolve(projectRoot),
    ...(bridgeManifestPath ? { bridgeManifestPath: path.resolve(bridgeManifestPath) } : {}),
  };
}

if (require.main === module) {
  const { projectRoot, bridgeManifestPath } = resolveMcpProjectRoot(
    process.argv,
    __filename,
    process.cwd(),
  );
  runMcpStdioServer(projectRoot, bridgeManifestPath);
}
