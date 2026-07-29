import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { AgentBridgeServer } from '../../src/agent/agentBridgeServer';
import {
  isProtectedAgentBridgePath,
  type AgentBridgeManifest,
} from '../../src/agent/agentBridgeContracts';
import { MutationApprovalRuntime } from '../../src/agent/mutationApprovalRuntime';
import { buildMcpConnectionCommands } from '../../src/agent/mcpConnection';
import {
  AgentBridgeClient,
  AgentBridgeClientError,
} from '../../src/mcp/agentBridgeClient';
import {
  BridgeAwareMcpToolRegistry,
  createBridgeMcpRequestId,
} from '../../src/mcp/bridgeTools';
import {
  handleMcpRequestAsync,
  resolveMcpProjectRoot,
  type JsonRpcMessage,
} from '../../src/mcp/mcpStdioServer';
import { createMcpOfflineToolRegistry } from '../../src/mcp/readonlyTools';
import { AgentService } from '../../src/agent/agentService';
import type { JsonObject, PatchApplyProposalRequest } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'agentBridgeServer');
const cleanupDirs: string[] = [];
const servers: AgentBridgeServer[] = [];
let sequence = 0;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AgentBridgeServer', () => {
  it('submits and observes an approval without exposing capabilities or writing the target', async () => {
    const { projectRoot, userDataPath, targetPath } = makeProject('roundtrip');
    const before = fs.readFileSync(targetPath);
    const { runtime, server, manifest } = await startBridge(projectRoot, userDataPath);
    const client = AgentBridgeClient.fromManifest(server.manifestPath, projectRoot);

    const submitted = await client.submit(makeRequest('bridge-roundtrip'));

    expect(submitted.status).toBe('needs-approval');
    expect(submitted.approval).toMatchObject({
      status: 'pending',
      requestSource: 'mcp',
      affectedPaths: ['Translated/Map001.txt'],
    });
    expect(JSON.stringify(submitted)).not.toContain(manifest.token);
    expect(JSON.stringify(submitted)).not.toContain(runtime.appSessionId);
    expect(JSON.stringify(submitted)).not.toContain(runtime.bridgeSessionId);
    expect(JSON.stringify(submitted)).not.toContain(path.resolve(projectRoot));
    expect(isProtectedAgentBridgePath(server.manifestPath)).toBe(true);
    expect(fs.readFileSync(targetPath)).toEqual(before);

    runtime.deny({
      schemaVersion: 1,
      approvalId: submitted.approval.approvalId,
      note: 'fixture denial',
    });
    const status = await client.getApproval(submitted.approval.approvalId);

    expect(status.status).toBe('denied');
    expect(JSON.stringify(status)).not.toContain('fixture denial');
    expect(fs.readFileSync(targetPath)).toEqual(before);
  });

  it('requires the bearer, app session, bridge session, and project binding without CORS', async () => {
    const { projectRoot, userDataPath } = makeProject('authentication');
    const { server, manifest } = await startBridge(projectRoot, userDataPath);

    const missing = await rawRequest(manifest, 'GET', '/v1/approvals/not-present', {});
    const wrongProjectHash = `${manifest.projectHash.slice(0, 63)}${
      manifest.projectHash.endsWith('0') ? '1' : '0'
    }`;
    const wrongProject = await rawRequest(manifest, 'GET', '/v1/approvals/not-present', {
      authorization: `Bearer ${manifest.token}`,
      'x-llm-tsukuru-app-session': manifest.appSessionId,
      'x-llm-tsukuru-bridge-session': manifest.bridgeSessionId,
      'x-llm-tsukuru-project': wrongProjectHash,
    });

    expect(missing.statusCode).toBe(401);
    expect(wrongProject.statusCode).toBe(401);
    expect(missing.headers['access-control-allow-origin']).toBeUndefined();
    expect(JSON.stringify(missing.body)).not.toContain(manifest.token);
    expect(server.isReady()).toBe(true);
  });

  it('limits proposal submission to ten requests per minute and keeps bytes unchanged', async () => {
    const { projectRoot, userDataPath, targetPath } = makeProject('rate');
    const before = fs.readFileSync(targetPath);
    const { server } = await startBridge(projectRoot, userDataPath);
    const client = AgentBridgeClient.fromManifest(server.manifestPath, projectRoot);
    const request = makeRequest('bridge-rate');

    for (let index = 0; index < 10; index += 1) {
      await expect(client.submit(request)).resolves.toMatchObject({ status: 'needs-approval' });
    }
    await expect(client.submit(request)).rejects.toMatchObject({ code: 'rate-limit' });
    expect(fs.readFileSync(targetPath)).toEqual(before);
  });

  it('rejects a manifest for another project and removes its manifest on stop', async () => {
    const first = makeProject('binding-a');
    const second = makeProject('binding-b');
    const { server } = await startBridge(first.projectRoot, first.userDataPath);

    expect(() => AgentBridgeClient.fromManifest(server.manifestPath, second.projectRoot))
      .toThrowError(expect.objectContaining({ code: 'project-mismatch' }));

    await server.stop();
    expect(fs.existsSync(server.manifestPath)).toBe(false);
  });
});

describe('MCP app bridge proxy', () => {
  it('exposes proposal and status tools and preserves JSON-RPC idempotency', async () => {
    const { projectRoot, userDataPath, targetPath } = makeProject('mcp-proxy');
    const before = fs.readFileSync(targetPath);
    const { runtime, server } = await startBridge(projectRoot, userDataPath);
    const offline = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const registry = new BridgeAwareMcpToolRegistry(offline, {
      manifestPath: server.manifestPath,
      projectRoot,
    });
    const requestId = createBridgeMcpRequestId('process-session', 'rpc-1');
    const request: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 'rpc-1',
      method: 'tools/call',
      params: {
        name: 'patch.apply',
        arguments: { patch: makeRequest('unused').patch as unknown as JsonObject },
      },
    };

    const first = await handleMcpRequestAsync(registry, request, requestId);
    const repeated = await handleMcpRequestAsync(registry, request, requestId);
    const firstPayload = readToolPayload(first?.result as JsonObject);
    const repeatedPayload = readToolPayload(repeated?.result as JsonObject);
    const approvalId = String((firstPayload.payload as JsonObject).approvalId);

    expect(registry.listTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'patch.apply',
      'approval.status',
      'project.context_snapshot',
    ]));
    expect((first?.result as JsonObject).isError).toBe(false);
    expect(firstPayload.status).toBe('needs-approval');
    expect((repeatedPayload.payload as JsonObject).approvalId).toBe(approvalId);
    expect(runtime.list({ schemaVersion: 1 })).toHaveLength(1);
    expect(fs.readFileSync(targetPath)).toEqual(before);

    runtime.deny({ schemaVersion: 1, approvalId });
    const statusResponse = await handleMcpRequestAsync(registry, {
      jsonrpc: '2.0',
      id: 'rpc-2',
      method: 'tools/call',
      params: {
        name: 'approval.status',
        arguments: { approvalId },
      },
    }, createBridgeMcpRequestId('process-session', 'rpc-2'));
    const statusPayload = readToolPayload(statusResponse?.result as JsonObject);
    expect(statusPayload.status).toBe('denied');
    expect(fs.readFileSync(targetPath)).toEqual(before);
  });

  it('fails bridge tools safely when the app manifest is unavailable', async () => {
    const { projectRoot, userDataPath, targetPath } = makeProject('offline');
    const before = fs.readFileSync(targetPath);
    const registry = new BridgeAwareMcpToolRegistry(
      createMcpOfflineToolRegistry(new AgentService({ projectRoot })),
      {
        manifestPath: path.join(userDataPath, 'missing.json'),
        projectRoot,
      },
    );

    const result = await registry.callTool(
      'patch.apply',
      { patch: makeRequest('offline').patch as unknown as JsonObject },
      'bridge-offline',
    );

    expect(result.status).toBe('failed');
    expect(result.failure?.message).toContain('bridge-unavailable');
    expect(fs.readFileSync(targetPath)).toEqual(before);
  });

  it('builds registration commands with a manifest path and no bearer or project argument', () => {
    const commands = buildMcpConnectionCommands(
      'C:\\project\\.llm-tsukuru-agent\\mcp-agent-server.cjs',
      'C:\\user\\agent-bridge.json',
    );

    expect(commands.codex).toContain('--bridge-manifest "C:\\user\\agent-bridge.json"');
    expect(commands.claude).toContain('--bridge-manifest "C:\\user\\agent-bridge.json"');
    expect(commands.codex).not.toContain('--project');
    expect(JSON.stringify(commands)).not.toMatch(/Bearer|token=/i);

    const resolved = resolveMcpProjectRoot(
      ['node', 'C:\\project\\.llm-tsukuru-agent\\mcp-agent-server.cjs', '--bridge-manifest', 'C:\\user\\agent-bridge.json'],
      'C:\\project\\.llm-tsukuru-agent\\mcp-agent-server.cjs',
      'C:\\fallback',
    );
    expect(resolved.projectRoot).toBe(path.resolve('C:\\project'));
    expect(resolved.bridgeManifestPath).toBe(path.resolve('C:\\user\\agent-bridge.json'));
  });
});

async function startBridge(projectRoot: string, userDataPath: string) {
  const runtime = new MutationApprovalRuntime({
    projectRoot,
    appSessionId: `app-bridge-test-${sequence}`,
    bridgeSessionId: `bridge-test-${sequence}`,
  });
  const server = new AgentBridgeServer({ runtime, userDataPath });
  servers.push(server);
  const manifest = await server.start();
  return { runtime, server, manifest };
}

function makeRequest(id: string): PatchApplyProposalRequest {
  return {
    schemaVersion: 1,
    requestId: id,
    idempotencyKey: id,
    toolName: 'patch.apply',
    patch: {
      schemaVersion: 1,
      patchId: `patch-${id}`,
      createdAt: '2026-07-29T00:00:00.000Z',
      dryRunOnly: true,
      targetPath: 'Translated/Map001.txt',
      operations: [{
        opId: 'replace-line-1',
        kind: 'replace-line',
        targetPath: 'Translated/Map001.txt',
        lineNumber: 2,
        originalText: 'Hello',
        replacementText: '안녕하세요',
      }],
      invariantPolicy: {
        preserveLineCount: true,
        requiresAlignmentProofForLineCountChange: true,
      },
    },
  };
}

function makeProject(prefix: string) {
  const projectRoot = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  const userDataPath = path.join(projectRoot, 'user-data');
  const targetPath = path.join(projectRoot, 'Translated', 'Map001.txt');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(targetPath, '--- 101 ---\nHello\n', 'utf-8');
  cleanupDirs.push(projectRoot);
  return { projectRoot, userDataPath, targetPath };
}

function readToolPayload(result: JsonObject): JsonObject {
  const content = result.content as JsonObject[];
  return JSON.parse(String(content[0].text)) as JsonObject;
}

function rawRequest(
  manifest: AgentBridgeManifest,
  method: 'GET' | 'POST',
  requestPath: string,
  headers: Record<string, string>,
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: manifest.host,
      port: manifest.port,
      path: requestPath,
      method,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf-8')),
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}
