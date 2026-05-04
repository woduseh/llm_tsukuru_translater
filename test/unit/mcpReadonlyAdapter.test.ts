import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent';
import { AGENT_SKILL_RECIPES } from '../../src/agent/agentSkillGuide';
import { issueAppBridgeToken, ProtocolLightMcpClient, ProtocolLightMcpServer, createMcpReadonlyToolRegistry, validateAppBridgeToken } from '../../src/mcp';
import { validateAgentResultEnvelope } from '../../src/agent/contractsValidation';
import type { AgentResultEnvelope, JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mcpReadonlyAdapter');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MCP read-only adapter scaffold', () => {
  it('handles initialize, list, and call through the protocol-light mock client', () => {
    const projectRoot = makeProject('protocol');
    const service = new AgentService({ projectRoot, engine: 'rpg-maker-mv' });
    const client = new ProtocolLightMcpClient(new ProtocolLightMcpServer(createMcpReadonlyToolRegistry(service)));

    expect(client.initialize().result).toMatchObject({
      protocolVersion: 'protocol-light',
      serverInfo: { sdk: 'not-installed' },
    });

    const list = client.listTools().result as JsonObject;
    expect((list.tools as JsonObject[]).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'project.context_snapshot',
      'settings.get_sanitized',
      'provider.list',
      'provider.readiness',
      'project.get_quality_rules',
      'project.translation_inventory',
       'project.scan_profile',
       'quality.review_file',
       'harness.latest',
       'artifacts.read_ref',
       'batch.estimate',
       'batch.plan',
       'corpus.sample',
       'help.translation_workflow',
       'help.explain_tool',
       'help.safe_recipe',
      ]));

    const call = client.callTool('project.context_snapshot').result as AgentResultEnvelope;
    expect(call.status).toBe('ok');
    expect(call.permissionTier).toBe('readonly');
    expect(validateAgentResultEnvelope(call).ok).toBe(true);
  });

  it('rejects invalid file args and path traversal without returning file contents', () => {
    const projectRoot = makeProject('reject');
    const outside = makeDir('outside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'api_key=outside-secret', 'utf-8');
    const service = new AgentService({ projectRoot });
    const registry = createMcpReadonlyToolRegistry(service);

    const invalidArgs = registry.callTool('quality.review_file', {});
    expect(invalidArgs.status).toBe('failed');
    expect(invalidArgs.failure?.message).toContain('requires a non-empty string path');

    const traversal = registry.callTool('quality.review_file', { path: path.join('..', path.basename(outside), 'secret.txt') });
    expect(traversal.status).toBe('failed');
    expect(JSON.stringify(traversal)).not.toContain('outside-secret');
  });

  it('redacts provider secrets from settings, provider readiness, file review, and harness artifacts', () => {
    const projectRoot = makeProject('redact');
    fs.mkdirSync(path.join(projectRoot, 'artifacts', 'harness'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'artifacts', 'harness', 'harness-core.json'), JSON.stringify({
      schemaVersion: 1,
      suite: 'harness-core',
      status: 'passed',
      token: 'super-secret-token',
    }), 'utf-8');
    const service = new AgentService({ projectRoot });
    const registry = createMcpReadonlyToolRegistry(service, {
      settings: {
        llmProvider: 'gemini',
        llmModel: 'gemini-2.5-flash',
        llmApiKey: 'AIza1234567890123456789012',
        llmCustomBaseUrl: 'http://127.0.0.1:1234/v1',
      },
    });

    const settings = registry.callTool('settings.get_sanitized');
    expect(JSON.stringify(settings)).not.toContain('AIza1234567890123456789012');
    expect((settings.payload as JsonObject).llmApiKey).toBe('[REDACTED]');

    const readiness = registry.callTool('provider.readiness');
    expect(JSON.stringify(readiness)).not.toContain('AIza1234567890123456789012');

    const review = registry.callTool('quality.review_file', { path: 'Extract\\Map001.txt' });
    expect(review.status).toBe('ok');
    expect(JSON.stringify(review)).not.toContain('secret-value');
    expect((review.payload as JsonObject).redactions).toBeTruthy();

    const latest = registry.callTool('harness.latest');
    expect(JSON.stringify(latest)).not.toContain('super-secret-token');
  });

  it('validates app bridge placeholder tokens by hash and never exposes token records', () => {
    const issued = issueAppBridgeToken(60_000, new Date('2025-01-01T00:00:00.000Z'));

    expect(issued.token).not.toBe(issued.record.tokenHash);
    expect(issued.record.redactedToken).toBe('[REDACTED]');
    expect(validateAppBridgeToken(issued.record, issued.token, new Date('2025-01-01T00:00:30.000Z'))).toBe(true);
    expect(validateAppBridgeToken(issued.record, `${issued.token}x`, new Date('2025-01-01T00:00:30.000Z'))).toBe(false);
    expect(validateAppBridgeToken(issued.record, issued.token, new Date('2025-01-01T00:02:00.000Z'))).toBe(false);
  });

  it('exposes safe agent guidance recipes without nonexistent tool references', () => {
    const projectRoot = makeProject('help');
    const registry = createMcpReadonlyToolRegistry(new AgentService({ projectRoot }));
    const toolNames = new Set(registry.listTools().map((tool) => tool.name));

    const workflow = registry.callTool('help.translation_workflow');
    expect(workflow.status).toBe('ok');
    expect(JSON.stringify(workflow.payload)).toContain('Preview before any run');
    expect(JSON.stringify(workflow.payload)).not.toContain('api_key=');

    const recipe = registry.callTool('help.safe_recipe', { recipeId: 'safe_apply' });
    expect(recipe.status).toBe('ok');
    expect(JSON.stringify(recipe.payload)).toContain('.extracteddata');

    const explained = registry.callTool('help.explain_tool', { toolName: 'quality.review_file' });
    expect(explained.status).toBe('ok');
    expect((explained.payload as JsonObject).permissionTier).toBe('readonly');

    const referencedTools = new Set(AGENT_SKILL_RECIPES.flatMap((guide) => guide.readonlyTools));
    for (const referencedTool of referencedTools) {
      expect(toolNames.has(referencedTool), `${referencedTool} should be registered`).toBe(true);
    }
  });

  it('guides provider-not-ready and no-project states without exposing secrets', () => {
    const projectRoot = makeProject('not-ready');
    const registry = createMcpReadonlyToolRegistry(new AgentService({ projectRoot }), {
      settings: { llmProvider: 'gemini', llmApiKey: '' },
    });

    const readiness = registry.callTool('provider.readiness');
    expect(readiness.status).toBe('ok');
    expect(JSON.stringify(readiness)).not.toContain('AIza');

    const providerSetup = registry.callTool('help.safe_recipe', { recipeId: 'provider_setup' });
    expect(JSON.stringify(providerSetup.payload)).toContain('enter credentials only in the app settings UI');

    const noProject = registry.callTool('project.translation_inventory', { maxFiles: 1 });
    expect(noProject.status).toBe('ok');
    expect(noProject.payload).toBeTruthy();
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
