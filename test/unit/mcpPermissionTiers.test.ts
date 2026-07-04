import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgentService } from '../../src/agent/agentService';
import {
  createMcpOfflineToolRegistry,
  createMcpReadonlyToolRegistry,
} from '../../src/mcp/readonlyTools';
import { handleMcpRequest } from '../../src/mcp/mcpStdioServer';
import type { JsonObject, TranslationPatch } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mcpPermissionTiers');
const cleanupDirs: string[] = [];
let sequence = 0;

const EXPECTED_WORKSPACE_WRITE_TOOLS = [
  'alignment.explain',
  'alignment.find_breaks',
  'alignment.inspect',
  'alignment.score',
  'batch.plan',
  'corpus.sample',
  'glossary.propose_entries',
  'job.graph_create',
  'patch.preview',
  'patch.propose',
  'qa.compare_versions',
  'qa.explain_score',
  'qa.score_batch',
  'qa.score_file',
  'qa.suggest_next_calls',
  'qa.threshold_gate',
  'repair.loop_plan',
  'repair.loop_run',
  'repair.loop_stop',
  'workflow.dry_run',
  'workflow.explain',
  'workflow.save_recipe',
].sort();

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MCP permission tiers', () => {
  it('keeps every strict readonly tool byte-stable for a successful fixture call', () => {
    const projectRoot = makeProject('readonly-matrix');
    fs.mkdirSync(path.join(projectRoot, 'artifacts', 'harness'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'artifacts', 'harness', 'harness-core.json'), JSON.stringify({
      schemaVersion: 1,
      suite: 'harness-core',
      status: 'passed',
    }), 'utf-8');
    const service = new AgentService({ projectRoot, engine: 'rpg-maker-mv' });

    const score = service.qa.scoreFile({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      metadataPath: 'Source\\Map001.extracteddata',
    });
    const loop = service.repair.loopRun({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 1,
      maxIterations: 1,
    });
    const graph = service.jobGraphs.create({
      graphId: 'readonly-fixture',
      nodes: [{ nodeId: 'qa', type: 'qa' }],
    });
    service.workflows.saveRecipe({
      recipeId: 'readonly-recipe',
      graph: { graphId: 'readonly-recipe-graph', nodes: [{ nodeId: 'qa', type: 'qa' }] },
    });

    const registry = createMcpReadonlyToolRegistry(service, {
      settings: {
        llmProvider: 'gemini',
        llmApiKey: 'configured-fixture-key',
        llmModel: 'gemini-fixture',
      },
    });
    const patch: TranslationPatch = {
      schemaVersion: 1,
      patchId: 'readonly-patch',
      createdAt: '2026-01-01T00:00:00.000Z',
      dryRunOnly: true,
      targetPath: 'Translated\\Map001.txt',
      operations: [{
        opId: 'op-1',
        kind: 'replace-line',
        targetPath: 'Translated\\Map001.txt',
        lineNumber: 2,
        originalText: '안녕하세요 \\V[1]',
        replacementText: '안녕 \\V[1]',
      }],
      invariantPolicy: {
        preserveLineCount: true,
        requiresAlignmentProofForLineCountChange: true,
      },
    };
    const calls: Record<string, JsonObject> = {
      'project.context_snapshot': {},
      'settings.get_sanitized': {},
      'provider.list': {},
      'provider.readiness': {},
      'project.get_quality_rules': {},
      'project.translation_inventory': { maxFiles: 100 },
      'project.scan_profile': { maxFiles: 20 },
      'quality.review_file': { path: 'Translated\\Map001.txt' },
      'harness.latest': {},
      'artifacts.read_ref': { refId: score.qaRef?.refId ?? '' },
      'batch.estimate': { maxFiles: 10 },
      'qa.read_score_ref': { refId: score.qaRef?.refId ?? '' },
      'patch.validate': { patch: patch as unknown as JsonObject },
      'repair.loop_status': { loopId: loop.loopId },
      'repair.loop_report': { loopId: loop.loopId },
      'glossary.search': { limit: 10 },
      'glossary.validate_usage': { text: '안녕하세요' },
      'memory.search': { limit: 10 },
      'memory.summarize': { limit: 10 },
      'job.graph_validate': { graphId: graph.graphId },
      'job.graph_status': { graphId: graph.graphId },
      'job.graph_artifacts': { graphId: graph.graphId },
      'workflow.compose': { preset: 'translation-review' },
      'workflow.validate': { preset: 'translation-review' },
      'workflow.list_recipes': {},
      'help.translation_workflow': {},
      'help.explain_tool': { toolName: 'quality.review_file' },
      'help.safe_recipe': { recipeId: 'quality_review' },
    };
    expect(Object.keys(calls).sort()).toEqual(registry.listTools().map((tool) => tool.name).sort());

    const before = snapshotTree(projectRoot);
    for (const [toolName, args] of Object.entries(calls)) {
      const result = registry.callTool(toolName, args, `readonly-${toolName}`);
      expect(result.status, `${toolName}: ${result.failure?.message ?? 'failed'}`).toBe('ok');
      expect(result.permissionTier).toBe('readonly');
    }
    expect(snapshotTree(projectRoot)).toEqual(before);
  });

  it('exposes only project reads and workspace writes from the offline registry', () => {
    const projectRoot = makeProject('offline-surface');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const definitions = registry.listTools();
    const names = definitions.map((tool) => tool.name);
    const workspaceWriteNames = definitions
      .filter((tool) => tool.permissionTier === 'workspace-write')
      .map((tool) => tool.name)
      .sort();

    expect(workspaceWriteNames).toEqual(EXPECTED_WORKSPACE_WRITE_TOOLS);
    expect(names).not.toContain('settings.get_sanitized');
    expect(names).not.toContain('provider.readiness');
    expect(names).not.toContain('harness.latest');
    expect(definitions.every((tool) => ['readonly', 'workspace-write'].includes(tool.permissionTier))).toBe(true);

    const response = handleMcpRequest(registry, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    const listed = (response?.result as JsonObject).tools as JsonObject[];
    for (const tool of listed) {
      const definition = definitions.find((candidate) => candidate.name === tool.name);
      expect((tool.annotations as JsonObject).readOnlyHint).toBe(definition?.permissionTier === 'readonly');
      expect((tool.annotations as JsonObject).destructiveHint).toBe(false);
    }
  });

  it('keeps workspace-write effects under .llm-tsukuru-agent', () => {
    const projectRoot = makeProject('workspace-write');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));
    const before = snapshotTree(projectRoot, true);

    const result = registry.callTool('batch.plan', { maxFiles: 10 });

    expect(result.status).toBe('ok');
    expect(result.permissionTier).toBe('workspace-write');
    expect(fs.existsSync(path.join(projectRoot, '.llm-tsukuru-agent'))).toBe(true);
    expect(snapshotTree(projectRoot, true)).toEqual(before);
  });

  it('does not materialize a workspace for construction or readonly context calls', () => {
    const projectRoot = makeProject('no-materialization');
    const workspaceRoot = path.join(projectRoot, '.llm-tsukuru-agent');
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot }));

    expect(fs.existsSync(workspaceRoot)).toBe(false);
    expect(registry.callTool('project.context_snapshot').status).toBe('ok');
    expect(registry.callTool('project.get_quality_rules').status).toBe('ok');
    expect(fs.existsSync(workspaceRoot)).toBe(false);
  });
});

function makeProject(prefix: string): string {
  const projectRoot = makeDir(prefix);
  fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'Source'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'data', 'Map001.json'), JSON.stringify({ events: [] }), 'utf-8');
  fs.writeFileSync(path.join(projectRoot, 'Source', 'Map001.txt'), '--- 101 ---\nHello \\V[1]\n', 'utf-8');
  fs.writeFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), '--- 101 ---\n안녕하세요 \\V[1]\n', 'utf-8');
  fs.writeFileSync(path.join(projectRoot, 'Source', 'Map001.extracteddata'), '{}', 'utf-8');
  return projectRoot;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

function snapshotTree(root: string, excludeWorkspace = false): string[] {
  const output: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (excludeWorkspace && current === root && entry.name === '.llm-tsukuru-agent') continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        output.push(`dir:${relative}`);
        visit(absolute);
      } else {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
        output.push(`file:${relative}:${digest}`);
      }
    }
  };
  visit(root);
  return output;
}
