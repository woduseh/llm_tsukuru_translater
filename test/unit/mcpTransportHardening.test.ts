import { afterEach, describe, expect, it } from 'vitest';
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

  it('publishes and enforces core patch and workflow argument contracts', () => {
    const projectRoot = makeDir('schema-contracts');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const patchDefinition = registry.listTools().find((tool) => tool.name === 'patch.validate');
    const workflowDefinition = registry.listTools().find((tool) => tool.name === 'workflow.compose');

    expect(patchDefinition?.inputSchema.required).toEqual(['patch']);
    expect((workflowDefinition?.inputSchema.properties as JsonObject).preset).toMatchObject({
      type: 'string',
      enum: ['translation-review', 'repair-loop', 'memory-glossary'],
    });

    const missingPatch = registry.callTool('patch.validate', {});
    expect(missingPatch.status).toBe('failed');
    expect(missingPatch.failure?.message).toContain('missing required property "patch"');

    const invalidPreset = registry.callTool('workflow.compose', { preset: 'typo' });
    expect(invalidPreset.status).toBe('failed');
    expect(invalidPreset.failure?.message).toContain('translation-review');

    const validPreset = registry.callTool('workflow.compose', { preset: 'repair-loop' });
    expect(validPreset.status).toBe('ok');
    expect(validPreset.payload?.title).toBe('Repair loop workflow');
  });
});

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return fs.realpathSync.native(dir);
}
