import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent';
import { createMcpReadonlyToolRegistry } from '../../src/mcp';
import type { JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'jobGraphWorkflows');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('job graph and workflow scaffolds', () => {
  it('creates and validates a valid DAG with manifest refs', () => {
    const service = new AgentService({ projectRoot: makeProject('valid') });
    const graph = service.jobGraphs.create({
      graphId: 'valid-dag',
      nodes: [
        { nodeId: 'extract', type: 'extract' },
        { nodeId: 'sample', type: 'sample', dependsOn: ['extract'] },
        { nodeId: 'translate', type: 'translate', dependsOn: ['sample'] },
        { nodeId: 'qa', type: 'qa', dependsOn: ['translate'] },
      ],
    });

    expect(graph.status).toBe('ready');
    expect(graph.validation.valid).toBe(true);
    expect(graph.validation.order).toEqual(['extract', 'sample', 'translate', 'qa']);
    expect(graph.manifestRef?.kind).toBe('job-graph-manifest');

    const status = service.jobGraphs.status('valid-dag');
    expect(status.status).toBe('ready');
    expect((status.nodes as JsonObject[])[0].progress).toBeTruthy();
  });

  it('rejects cycles and missing dependencies during validation', () => {
    const service = new AgentService({ projectRoot: makeProject('invalid') });

    const cycle = service.jobGraphs.create({
      graphId: 'cycle',
      nodes: [
        { nodeId: 'a', type: 'sample', dependsOn: ['b'] },
        { nodeId: 'b', type: 'qa', dependsOn: ['a'] },
      ],
    });
    const missing = service.jobGraphs.create({
      graphId: 'missing',
      nodes: [{ nodeId: 'qa', type: 'qa', dependsOn: ['translate'] }],
    });

    expect(cycle.status).toBe('invalid');
    expect(cycle.validation.errors.join('\n')).toMatch(/Cycle detected/);
    expect(missing.status).toBe('invalid');
    expect(missing.validation.errors.join('\n')).toMatch(/unknown node/);
    expect(() => service.jobGraphs.dryRun('cycle')).toThrow(/invalid/);
  });

  it('dry-runs in dependency order and exposes status and artifacts without project file mutations', () => {
    const projectRoot = makeProject('dryrun');
    const before = fs.readFileSync(path.join(projectRoot, 'Extract', 'Map001.txt'), 'utf-8');
    const service = new AgentService({ projectRoot });
    const graph = service.jobGraphs.create({
      graphId: 'ordered',
      nodes: [
        { nodeId: 'sample', type: 'sample', dependsOn: ['extract'] },
        { nodeId: 'extract', type: 'extract' },
        { nodeId: 'qa', type: 'qa', dependsOn: ['sample'] },
        { nodeId: 'verify', type: 'verify', dependsOn: ['qa'] },
      ],
    });

    const result = service.jobGraphs.dryRun(graph.graphId);
    const after = fs.readFileSync(path.join(projectRoot, 'Extract', 'Map001.txt'), 'utf-8');
    const status = service.jobGraphs.status(graph.graphId);
    const artifacts = service.jobGraphs.artifacts(graph.graphId);

    expect(result.order).toEqual(['extract', 'sample', 'qa', 'verify']);
    expect(result.sideEffects).toEqual([]);
    expect(after).toBe(before);
    expect(status.status).toBe('completed');
    expect((status.progress as JsonObject).completed).toBe(4);
    expect((artifacts.dryRunRefs as JsonObject[])).toHaveLength(1);
  });

  it('composes workflows and saves/lists recipes through MCP tools', () => {
    const service = new AgentService({ projectRoot: makeProject('mcp') });
    const registry = createMcpReadonlyToolRegistry(service);

    const compose = registry.callTool('workflow.compose', { preset: 'repair-loop', workflowId: 'repair-flow' });
    expect(compose.status).toBe('ok');
    expect(((compose.payload as JsonObject).validation as JsonObject).valid).toBe(true);

    const create = registry.callTool('job.graph_create', (compose.payload as JsonObject));
    expect(create.status).toBe('ok');
    const graphId = (create.payload as JsonObject).graphId as string;

    const dryRun = registry.callTool('workflow.dry_run', { graphId });
    expect(dryRun.status).toBe('ok');
    expect((dryRun.payload as JsonObject).order).toEqual(['qa', 'align', 'repair', 'patch', 'verify']);

    const save = registry.callTool('workflow.save_recipe', { recipeId: 'repair-recipe', workflow: { preset: 'repair-loop' } });
    const list = registry.callTool('workflow.list_recipes');
    expect(save.status).toBe('ok');
    expect(list.status).toBe('ok');
    expect(((list.payload as JsonObject).recipes as JsonObject[]).map((recipe) => recipe.recipeId)).toContain('repair-recipe');
  });
});

function makeProject(prefix: string): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Extract'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.txt'), ['--- 101 ---', 'Hello', '안녕'].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.extracteddata'), '{}', 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
