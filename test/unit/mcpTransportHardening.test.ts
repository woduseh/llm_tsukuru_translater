import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';
import { handleMcpLine } from '../../src/mcp/mcpStdioServer';
import { createMcpOfflineToolRegistry } from '../../src/mcp/readonlyTools';
import type { JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mcpTransportHardening');
const cleanupDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MCP transport hardening', () => {
  it('returns a fixed parse error without reflecting malformed input or parser details', async () => {
    const projectRoot = makeDir('parse-error');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const response = await handleMcpLine(
      registry,
      '{"jsonrpc":"2.0","id":1,"method":Bearer sentinel-secret-2468}',
      'parse-session',
    );

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error.' },
    });
    expect(JSON.stringify(response)).not.toContain('sentinel-secret-2468');
    expect(JSON.stringify(response)).not.toContain('Unexpected token');
  });

  it.each([
    { label: 'null', request: null },
    { label: 'array', request: [] },
    { label: 'scalar', request: 42 },
    { label: 'wrong version on a tool call', request: { jsonrpc: '1.0', id: 7, method: 'tools/call', params: { name: 'project.context_snapshot' } } },
  ])('rejects $label as an invalid request before dispatching tools', async ({ request }) => {
    const registry = { listTools: vi.fn(() => []), callTool: vi.fn(() => ({
      schemaVersion: 1 as const, requestId: 'invalid-request-session', toolName: 'project.context_snapshot',
      status: 'ok' as const, permissionTier: 'readonly' as const, payload: {}, audit: [], redactions: [],
    })) };

    const response = await handleMcpLine(registry, JSON.stringify(request), 'invalid-request-session');

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: request && typeof request === 'object' && 'id' in request ? request.id : null,
      error: { code: -32600, message: 'Invalid JSON-RPC request.' },
    });
    expect(registry.callTool).not.toHaveBeenCalled();
  });

  it('detects Wolf projects and keeps both binary and extracted-text inventory visible', () => {
    const projectRoot = makeDir('wolf-project');
    fs.writeFileSync(path.join(projectRoot, 'Data.wolf'), Buffer.from([0, 1, 2, 3]));
    fs.mkdirSync(path.join(projectRoot, '_Extract', 'Texts'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '_Extract', 'Texts', 'Map001.txt'), '--- 101-0 ---\nHello\n', 'utf8');
    fs.writeFileSync(path.join(projectRoot, '_Extract', '.extracteddata'), '{}', 'utf8');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));

    const context = registry.callTool('project.context_snapshot').payload as JsonObject;
    const inventory = registry.callTool('project.translation_inventory').payload as JsonObject;

    expect((context.engine as JsonObject).name).toBe('wolf-rpg');
    expect(inventory.projectEngine).toBe('wolf-rpg');
    expect(inventory.wolfDetected).toBe(true);
    expect((inventory.wolfDataFiles as JsonObject[]).map((entry) => entry.path)).toContain('Data.wolf');
    expect((inventory.extractedTextFiles as JsonObject[]).map((entry) => entry.path)).toContain(path.join('_Extract', 'Texts', 'Map001.txt'));
    expect((inventory.extractedMetadataFiles as JsonObject[]).map((entry) => entry.path)).toContain(path.join('_Extract', '.extracteddata'));
  });

  it('detects an already-decrypted Wolf Data tree without a Data.wolf archive', () => {
    const projectRoot = makeDir('decrypted-wolf-project');
    const mapDir = path.join(projectRoot, 'Data', 'MapData');
    fs.mkdirSync(mapDir, { recursive: true });
    fs.writeFileSync(path.join(mapDir, 'Map001.mps'), Buffer.from([0, 1, 2, 3]));
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));

    const context = registry.callTool('project.context_snapshot').payload as JsonObject;
    const inventory = registry.callTool('project.translation_inventory').payload as JsonObject;

    expect((context.engine as JsonObject).name).toBe('wolf-rpg');
    expect(inventory.projectEngine).toBe('wolf-rpg');
    expect((inventory.wolfDataFiles as JsonObject[]).map((entry) => entry.path))
      .toContain(path.join('Data', 'MapData', 'Map001.mps'));
  });
  it('publishes and enforces the public patch argument contract', () => {
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot: makeDir('schema-contracts') }));
    const patch = registry.listTools().find(tool => tool.name === 'patch.validate');
    expect(patch?.inputSchema.required).toEqual(['patch']);
    const missing = registry.callTool('patch.validate', {});
    expect(missing.status).toBe('failed');
    expect(missing.failure?.message).toContain('missing required property "patch"');
    const invalid = registry.callTool('patch.propose', { targetPath: 'Map001.txt', operations: [] });
    expect(invalid.status).toBe('failed');
    expect(invalid.failure?.message).toContain('too few items');
  });
});

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return fs.realpathSync.native(dir);
}
