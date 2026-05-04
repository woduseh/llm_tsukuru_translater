import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent';
import { createMcpReadonlyToolRegistry } from '../../src/mcp';
import type { JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'repairLoopService');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('auto repair loop scaffolds', () => {
  it('generates a dry-run plan for low QA with suggested actions and refs', () => {
    const service = new AgentService({ projectRoot: makeProject('low-plan', ['Hello adventurer'], ['Hello adventurer']) });

    const plan = service.repair.loopPlan({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 0.99,
    });

    expect(plan.dryRunOnly).toBe(true);
    expect(plan.initialScore.qualityScore).toBeLessThan(0.99);
    expect(plan.actions.some((action) => action.kind === 'retranslation')).toBe(true);
    expect(plan.planRef?.kind).toBe('repair-loop-plan');
    expect(plan.nextSuggestedCalls).toContain('repair.loop_run');
  });

  it('stops immediately when QA already meets the threshold', () => {
    const service = new AgentService({
      projectRoot: makeProject('high-stop', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', '안녕 \\V[1]']),
    });

    const run = service.repair.loopRun({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt', threshold: 0.9 });

    expect(run.status).toBe('completed');
    expect(run.stopReason).toBe('threshold-reached');
    expect(run.iterations).toEqual([]);
    expect(run.reportRef?.kind).toBe('repair-loop-report');
  });

  it('hard-stops on line-count uncertainty', () => {
    const service = new AgentService({ projectRoot: makeProject('line-count', ['--- 101 ---', 'Hello'], ['--- 101 ---', '안녕', 'extra']) });

    const run = service.repair.loopRun({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt', threshold: 0.9 });

    expect(run.status).toBe('blocked');
    expect(run.stopReason).toBe('line-count-uncertainty');
    expect(run.hardStops.some((stop) => stop.code === 'line-count-uncertainty')).toBe(true);
  });

  it('hard-stops on patch conflicts during simulation', () => {
    const service = new AgentService({ projectRoot: makeProject('patch-conflict', ['Hello adventurer'], ['Hello adventurer']) });

    const run = service.repair.loopRun({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 0.99,
      repairOperations: [{ lineNumber: 1, originalText: 'Hello adventurer', replacementText: '안녕\n추가 줄' }],
    });

    expect(run.status).toBe('blocked');
    expect(run.stopReason).toBe('patch-conflict');
    expect(run.hardStops.some((stop) => stop.code === 'patch-conflict')).toBe(true);
  });

  it('stops after max iterations when only unavailable provider repair remains', () => {
    const service = new AgentService({ projectRoot: makeProject('max-iteration', ['Hello adventurer'], ['Hello adventurer']) });

    const run = service.repair.loopRun({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 1,
      maxIterations: 1,
    });

    expect(run.status).toBe('stopped');
    expect(run.stopReason).toBe('max-iterations-exceeded');
    expect(run.iterations).toHaveLength(1);
  });

  it('reports findings, planned actions, artifacts, and MCP next calls', () => {
    const service = new AgentService({ projectRoot: makeProject('report', ['Hello adventurer'], ['Hello adventurer']) });
    const registry = createMcpReadonlyToolRegistry(service);

    expect(registry.listTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'repair.loop_plan',
      'repair.loop_run',
      'repair.loop_status',
      'repair.loop_stop',
      'repair.loop_report',
    ]));

    const run = registry.callTool('repair.loop_run', {
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 1,
      maxIterations: 1,
    });
    const loopId = (run.payload as JsonObject).loopId as string;
    const report = registry.callTool('repair.loop_report', { loopId });
    const payload = report.payload as JsonObject;

    expect(run.status).toBe('ok');
    expect(run.nextSuggestedCalls).toContain('repair.loop_report');
    expect(Array.isArray(payload.findings)).toBe(true);
    expect(Array.isArray(payload.actions)).toBe(true);
    expect(Array.isArray(payload.artifacts)).toBe(true);
    expect(report.nextSuggestedCalls).toContain('repair.loop_report');
  });
});

function makeProject(prefix: string, sourceLines: string[], targetLines: string[]): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Source', 'Map001.txt'), sourceLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Source', 'Map001.extracteddata'), JSON.stringify({
    1: { val: 'events.1.pages.0.list.0.parameters.0', m: sourceLines.length + 1, origin: 'Map001.json' },
  }), 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
