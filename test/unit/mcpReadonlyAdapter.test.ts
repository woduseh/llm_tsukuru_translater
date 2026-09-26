import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolLightMcpClient, ProtocolLightMcpServer } from '../utils/mcpClient';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';
import { AGENT_SKILL_RECIPES } from '../../src/agent/agentSkillGuide';
import {
  issueAppBridgeToken,
  createMcpOfflineToolRegistry,
  createMcpReadonlyToolRegistry,
  validateAppBridgeToken,
} from '../../src/mcp';
import type { JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mcpReadonlyAdapter');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MCP public read-only adapter', () => {
  it('handles initialize, list, and call through the protocol-light mock client', () => {
    const projectRoot = makeProject('protocol');
    const service = new AgentService({ projectRoot, engine: 'rpg-maker-mv' });
    const client = new ProtocolLightMcpClient(new ProtocolLightMcpServer(createMcpReadonlyToolRegistry(service)));

    expect(client.initialize().result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'llm-tsukuru-translater' },
    });

    const list = client.listTools().result as JsonObject;
    expect((list.tools as JsonObject[]).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'project.context_snapshot',
      'provider.list',
      'project.get_quality_rules',
      'project.translation_inventory',
       'artifacts.read_ref',
       'help.translation_workflow',
       'help.explain_tool',
       'help.safe_recipe',
      ]));

    const call = client.callTool('project.context_snapshot').result as JsonObject;
    expect(call.isError).toBe(false);
    expect(readToolPayload(call).projectRoot).toBe(projectRoot);
  });

  it('rejects invalid file args and path traversal without returning file contents', () => {
    const projectRoot = makeProject('reject');
    const outside = makeDir('outside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'api_key=outside-secret', 'utf-8');
    const service = new AgentService({ projectRoot });
    const registry = createMcpReadonlyToolRegistry(service);

    const invalidArgs = registry.callTool('translation.read_window', {});
    expect(invalidArgs.status).toBe('failed');
    expect(invalidArgs.failure?.message).toContain('missing required property "targetPath"');

    const traversal = registry.callTool('translation.read_window', { targetPath: path.join('..', path.basename(outside), 'secret.txt') });
    expect(traversal.status).toBe('failed');
    expect(JSON.stringify(traversal)).not.toContain('outside-secret');
  });
  it('redacts text and saved analysis through the public read-only surface', () => {
    const service = new AgentService({ projectRoot: makeProject('redact') });
    const artifact = service.artifacts.writeJsonArtifact('qa-score', 'secret', { token: 'super-secret-token', findings: [] });
    const ref = service.dataRefs.registerArtifactRef(artifact, { kind: 'qa-score' });
    const registry = createMcpReadonlyToolRegistry(service);
    const review = registry.callTool('translation.read_window', { targetPath: 'Extract/Map001.txt' });
    expect(review.status).toBe('ok');
    expect(JSON.stringify(review)).not.toContain('secret-value');
    const page = registry.callTool('artifacts.read_ref', { refId: ref.refId });
    expect(page.status).toBe('ok');
    expect(JSON.stringify(page)).not.toContain('super-secret-token');
    expect(registry.callTool('provider.list').status).toBe('ok');
  });

  it('validates app bridge loopback tokens by hash and never exposes token records', () => {
    const issued = issueAppBridgeToken(60_000, new Date('2025-01-01T00:00:00.000Z'));

    expect(issued.token).not.toBe(issued.record.tokenHash);
    expect(issued.record.redactedToken).toBe('[REDACTED]');
    expect(validateAppBridgeToken(issued.record, issued.token, new Date('2025-01-01T00:00:30.000Z'))).toBe(true);
    expect(validateAppBridgeToken(issued.record, `${issued.token}x`, new Date('2025-01-01T00:00:30.000Z'))).toBe(false);
    expect(validateAppBridgeToken(issued.record, issued.token, new Date('2025-01-01T00:02:00.000Z'))).toBe(false);
  });

  it('exposes safe agent guidance recipes without nonexistent tool references', () => {
    const projectRoot = makeProject('help');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const toolNames = new Set(registry.listTools().map((tool) => tool.name));

    const workflow = registry.callTool('help.translation_workflow');
    expect(workflow.status).toBe('ok');
    expect(JSON.stringify(workflow.payload)).toContain('Run translation and apply through the app UI');
    expect(JSON.stringify(workflow.payload)).not.toContain('api_key=');
    expect(workflow.payload?.capabilities).toMatchObject({ mode: 'offline' });
    expect(workflow.payload).not.toHaveProperty('guideText');

    const recipe = registry.callTool('help.safe_recipe', { recipeId: 'quality_review' });
    expect(recipe.status).toBe('ok');
    expect(JSON.stringify(recipe.payload)).toContain('.extracteddata');
    expect(recipe.payload?.recipe).not.toHaveProperty('safety');
    const repair = registry.callTool('help.safe_recipe', { recipeId: 'line_shift_repair' });
    expect((repair.payload?.recipe as JsonObject).tools).toContain('patch.propose');
    expect((repair.payload?.recipe as JsonObject).tools).not.toContain('patch.apply');
    expect(registry.callTool('help.explain_tool', { toolName: 'patch.apply' }).payload?.status).toBe('unknown');

    const explained = registry.callTool('help.explain_tool', { toolName: 'translation.read_window' });
    expect(explained.status).toBe('ok');
    expect((explained.payload as JsonObject).permissionTier).toBe('readonly');

    const referencedTools = new Set(AGENT_SKILL_RECIPES.flatMap((guide) => guide.tools));
    for (const referencedTool of referencedTools) {
      expect(toolNames.has(referencedTool), `${referencedTool} should be registered`).toBe(true);
    }
  });
  it('keeps provider setup guidance in the app and returns bounded inventory', () => {
    const registry = createMcpReadonlyToolRegistry(new AgentService({ projectRoot: makeProject('setup') }));
    const setup = registry.callTool('help.safe_recipe', { recipeId: 'provider_setup' });
    expect(setup.status).toBe('ok');
    expect(JSON.stringify(setup.payload)).toContain('enter credentials only in the app settings UI');
    expect(registry.callTool('project.translation_inventory', { maxFiles: 1 }).status).toBe('ok');
  });
});

function makeProject(prefix: string): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Extract'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'Map001.json'), JSON.stringify({ events: [] }), 'utf-8');
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.txt'), '--- 101 ---\nHello \\V[1]\n\napi_key=secret-value\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.extracteddata'), '{}', 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

function readToolPayload(result: JsonObject): JsonObject {
  const content = result.content as JsonObject[];
  return JSON.parse(String(content[0].text)) as JsonObject;
}
