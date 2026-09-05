import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';
import { AgentBridgeServer } from '../../src/agent/agentBridgeServer';
import { MutationApprovalRuntime } from '../../src/agent/mutationApprovalRuntime';
import { BridgeAwareMcpToolRegistry, type AsyncMcpToolRegistryLike } from '../../src/mcp/bridgeTools';
import { createMcpOfflineToolRegistry } from '../../src/mcp/readonlyTools';
import { handleMcpLine } from '../../src/mcp/mcpStdioServer';
import type { JsonObject, JsonValue } from '../../src/types/agentWorkspace';

const sandbox = path.resolve('artifacts', 'unit', 'mcpAgentWorkflow');
let projectRoot: string;
let server: AgentBridgeServer | undefined;
let requestId = 0;
const sourcePath = 'Extract/Map001.txt';
const targetPath = 'Translated/Map001.txt';

beforeEach(() => {
  fs.mkdirSync(sandbox, { recursive: true });
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'workflow-'));
  fs.mkdirSync(path.join(projectRoot, 'Extract'));
  fs.mkdirSync(path.join(projectRoot, 'Translated'));
  fs.writeFileSync(path.join(projectRoot, sourcePath), '--- 101 ---\r\nHello\r\n\r\n');
  fs.writeFileSync(path.join(projectRoot, targetPath), '--- 101 ---\r\nHello\r\n\r\n');
});
afterEach(async () => {
  if (server) await server.stop();
  server = undefined;
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

async function rpc(registry: AsyncMcpToolRegistryLike, method: string, params: JsonObject = {}): Promise<JsonObject> {
  const response = await handleMcpLine(registry, JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), 'agent-workflow-test');
  expect(response?.error).toBeUndefined();
  return response?.result as JsonObject;
}

async function call(registry: AsyncMcpToolRegistryLike, name: string, args: JsonObject = {}): Promise<JsonObject> {
  const result = await rpc(registry, 'tools/call', { name, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBe(false);
  return JSON.parse(String((result.content as JsonObject[])[0].text)) as JsonObject;
}

/** Build only required inputs from the advertised schema, with no implementation knowledge. */
function requiredExample(schema: JsonObject): JsonValue {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === 'object') {
    const properties = (schema.properties ?? {}) as JsonObject;
    return Object.fromEntries(((schema.required ?? []) as string[]).map((key) => [key, requiredExample(properties[key] as JsonObject)]));
  }
  if (schema.type === 'array') return Array.from({ length: Number(schema.minItems ?? 1) }, () => requiredExample(schema.items as JsonObject));
  if (schema.type === 'integer' || schema.type === 'number') return Number(schema.minimum ?? 1);
  if (schema.type === 'boolean') return true;
  return 'fixture';
}

describe('task-oriented MCP agent workflow', () => {
  it('publishes sixteen closed input contracts and rejects unknown arguments on every public tool', async () => {
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    expect(await rpc(registry, 'initialize', { protocolVersion: '2025-06-18' })).toMatchObject({ protocolVersion: '2025-06-18' });
    const list = await rpc(registry, 'tools/list');
    const tools = list.tools as JsonObject[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'alignment.inspect', 'artifacts.read_ref', 'glossary.search', 'help.explain_tool', 'help.safe_recipe',
      'help.translation_workflow', 'memory.search', 'patch.propose', 'patch.validate', 'project.context_snapshot',
      'project.get_quality_rules', 'project.translation_inventory', 'provider.list', 'qa.score_file',
      'translation.read_window', 'translation.search',
    ].sort());
    for (const tool of tools) {
      const schema = tool.inputSchema as JsonObject;
      expect(schema.additionalProperties, String(tool.name)).toBe(false);
      const response = registry.callTool(String(tool.name), { ...requiredExample(schema) as JsonObject, unexpectedArgument: true });
      expect(response.status, String(tool.name)).toBe('failed');
      expect(response.failure?.message, String(tool.name)).toContain('unexpectedArgument');
    }
    for (const count of [0, 201, 1.5]) {
      const result = await rpc(registry, 'tools/call', { name: 'translation.read_window', arguments: { targetPath, count } });
      expect(result.isError).toBe(true);
    }
  });

  it('completes read, QA, proposal, bridge approval and reread through the public protocol', async () => {
    const sourceBefore = fs.readFileSync(path.join(projectRoot, sourcePath));
    const targetBefore = fs.readFileSync(path.join(projectRoot, targetPath));
    const runtime = new MutationApprovalRuntime({ projectRoot });
    const userDataPath = path.join(projectRoot, 'user-data');
    fs.mkdirSync(userDataPath);
    server = new AgentBridgeServer({ runtime, userDataPath });
    const manifest = await server.start();
    const registry = new BridgeAwareMcpToolRegistry(createMcpOfflineToolRegistry(new AgentService({ projectRoot })), { projectRoot, manifestPath: server.manifestPath });
    const connection = await call(registry, 'bridge.status');
    expect(connection).toMatchObject({ schemaVersion: 1, available: true, approvalRequired: true });
    expect(connection.limits).toMatchObject({ targetFileBytes: expect.any(Number), operations: expect.any(Number) });
    expect(JSON.stringify(connection)).not.toContain(manifest.token);
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(0);
    // The live probe must traverse the authenticated endpoint, which rejects anonymous callers.
    const anonymousStatus = await new Promise<number | undefined>((resolve, reject) => {
      http.get({ hostname: manifest.host, port: manifest.port, path: '/v1/status' }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    expect(anonymousStatus).toBe(401);
    const window = await call(registry, 'translation.read_window', { sourcePath, targetPath, startLine: 2, count: 1 });
    expect(window.textIsExact).toBe(true);
    const current = ((window.rows as JsonObject[])[0].target as JsonObject).text;
    const qa = await call(registry, 'qa.score_file', { sourcePath, targetPath });
    expect(qa.semanticQuality).toBe('not-evaluated');
    const proposal = await call(registry, 'patch.propose', { targetPath, operations: [{ lineNumber: 2, originalText: current, replacementText: '안녕하세요' }] });
    expect(proposal.validation).toMatchObject({ valid: true, applicable: true });
    expect(proposal.preview).toMatchObject({ dryRunOnly: true, lineCountBefore: 4, lineCountAfter: 4 });
    expect((await call(registry, 'patch.validate', { patch: proposal.patch })).valid).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, targetPath))).toEqual(targetBefore);
    const idempotencyKey = 'workflow-proposal-1';
    for (const [name, args] of [
      ['bridge.status', { unexpected: true }],
      ['approval.status', { approvalId: 'placeholder', unexpected: true }],
      ['patch.apply', { patch: proposal.patch, unexpected: true }],
      ['patch.apply', { patch: 'malformed' }],
      ['patch.apply', { patch: proposal.patch, idempotencyKey: '' }],
      ['approval.status', { approvalId: 123 }],
    ] as [string, JsonObject][]) {
      const invalid = await rpc(registry, 'tools/call', { name, arguments: args });
      expect(invalid.isError, name).toBe(true);
      const failure = JSON.parse(String((invalid.content as JsonObject[])[0].text)) as JsonObject;
      expect(failure.retryable, name).toBe(false);
    }
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(0);
    const submission = await call(registry, 'patch.apply', { patch: proposal.patch, idempotencyKey });
    expect(submission.status).toBe('needs-approval');
    const approvalId = String((submission.payload as JsonObject).approvalId);
    // call() assigns a new JSON-RPC id; the explicit key survives uncertain transport retries.
    const repeated = await call(registry, 'patch.apply', { patch: proposal.patch, idempotencyKey });
    expect(repeated.status).toBe('needs-approval');
    expect((repeated.payload as JsonObject).approvalId).toBe(approvalId);
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(1);
    expect(await call(registry, 'approval.status', { approvalId })).toMatchObject({ status: 'pending' });
    expect(fs.readFileSync(path.join(projectRoot, targetPath))).toEqual(targetBefore);
    // Explicit app-side user approval, not an agent-callable approval shortcut.
    expect(await runtime.approve({ schemaVersion: 1, approvalId })).toMatchObject({ status: 'applied' });
    expect(await call(registry, 'approval.status', { approvalId })).toMatchObject({ status: 'applied' });
    expect(await call(registry, 'patch.apply', { patch: proposal.patch, idempotencyKey })).toMatchObject({ status: 'applied', approvalId });
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(1);
    const after = await call(registry, 'translation.read_window', { targetPath, startLine: 2, count: 1 });
    expect(after.rows).toMatchObject([{ lineNumber: 2, target: { text: '안녕하세요', eol: '\r\n' } }]);
    expect(fs.readFileSync(path.join(projectRoot, sourcePath))).toEqual(sourceBefore);
    expect(fs.readFileSync(path.join(projectRoot, targetPath), 'utf8')).toBe('--- 101 ---\r\n안녕하세요\r\n\r\n');
    expect(await call(registry, 'qa.score_file', { sourcePath, targetPath })).toMatchObject({ verified: true, coverage: 'full', semanticQuality: 'not-evaluated' });
  });

  it('returns bounded findings and complete artifact pagination while blocking prefix-only QA', async () => {
    const lines = Array.from({ length: 35 }, (_, i) => `Hello ${i}`).join('\n');
    fs.writeFileSync(path.join(projectRoot, sourcePath), lines);
    fs.writeFileSync(path.join(projectRoot, targetPath), lines);
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const qa = await call(registry, 'qa.score_file', { sourcePath, targetPath });
    expect((qa.findings as JsonObject[]).length).toBe(20);
    expect(Number(qa.findingCount)).toBeGreaterThanOrEqual(35);
    const details = qa.details as JsonObject;
    const all: JsonObject[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await call(registry, 'artifacts.read_ref', { refId: details.refId, collection: 'findings', offset, limit: 7 });
      expect(page.items).toBeInstanceOf(Array);
      all.push(...page.items as JsonObject[]);
      if (page.nextOffset !== null) expect(Number(page.nextOffset)).toBeGreaterThan(offset);
      offset = page.nextOffset as number | null;
    }
    expect(all).toHaveLength(Number(qa.findingCount));
    const partial = await call(registry, 'qa.score_file', { sourcePath, targetPath, maxBytes: 16 });
    expect(partial).toMatchObject({ coverage: 'partial', verified: false, gate: 'blocked' });
    expect(fs.readFileSync(path.join(projectRoot, targetPath), 'utf8')).toBe(lines);
  });
});
