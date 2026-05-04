import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent';
import { createMcpReadonlyToolRegistry } from '../../src/mcp';
import type { AgentResultEnvelope, JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'dataRefsBatchCorpus');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('data refs, batch planning, and corpus sampling kernels', () => {
  it('creates bounded redacted refs, rejects expired refs, and rejects wrong project reads', () => {
    const projectRoot = makeProject('refs');
    const service = new AgentService({ projectRoot });
    const artifact = service.artifacts.writeJsonArtifact('fixture', 'secret', {
      message: 'api_key=super-secret-value',
      lines: ['safe'],
    });
    const ref = service.dataRefs.registerArtifactRef(artifact, { ttlMs: 60_000, metadata: { purpose: 'unit-test' } });

    const read = service.dataRefs.readRef(ref.refId, { maxBytes: 8 * 1024, projectRoot });

    expect(read.truncated).toBe(false);
    expect(JSON.stringify(read)).not.toContain('super-secret-value');
    expect(read.ref.metadata.purpose).toBe('unit-test');
    expect(() => service.dataRefs.readRef(ref.refId, { projectRoot: makeDir('other-project') })).toThrow(/different project/);

    const expired = service.dataRefs.registerArtifactRef(artifact, { ttlMs: -1 });
    expect(() => service.dataRefs.readRef(expired.refId, { projectRoot })).toThrow(/expired/);
  });

  it('plans dry-run batches from inventory with limits and exposes the manifest through MCP refs', () => {
    const projectRoot = makeProject('batch');
    const service = new AgentService({ projectRoot });
    const registry = createMcpReadonlyToolRegistry(service);

    const plan = registry.callTool('batch.plan', {
      limits: { maxFiles: 3, maxTotalLines: 8, maxLinesPerBatch: 4, maxBatches: 2 },
      dryRun: true,
    });

    expect(plan.status).toBe('ok');
    const payload = plan.payload as JsonObject;
    expect(payload.dryRun).toBe(true);
    expect((payload.inventory as JsonObject).plannedLines as number).toBeLessThanOrEqual(8);
    expect((payload.batches as JsonObject[]).length).toBeLessThanOrEqual(2);

    const manifestRef = (payload.manifestRef as JsonObject).refId as string;
    const read = registry.callTool('artifacts.read_ref', { refId: manifestRef, maxBytes: 32 * 1024 });
    expect(read.status).toBe('ok');
    expect(JSON.stringify(read)).not.toContain('super-secret-value');
    expect(validateEnvelope(read)).toBe(true);
  });

  it('returns bounded deterministic corpus samples for each strategy without dumping full files', () => {
    const projectRoot = makeProject('corpus');
    const service = new AgentService({ projectRoot });

    const deterministic = service.corpus.sample({ strategy: 'deterministic', maxSamples: 2, maxLineChars: 12 });
    const deterministicAgain = service.corpus.sample({ strategy: 'deterministic', maxSamples: 2, maxLineChars: 12 });
    const longest = service.corpus.sample({ strategy: 'longest-lines', maxSamples: 1, maxLineChars: 20 });
    const controls = service.corpus.sample({ strategy: 'control-code-heavy', maxSamples: 1, maxLineChars: 80 });
    const untranslated = service.corpus.sample({ strategy: 'untranslated-heavy', maxSamples: 2, maxLineChars: 80 });
    const random = service.corpus.sample({ strategy: 'random', seed: 42, maxSamples: 3, maxLineChars: 16 });

    expect(projectedSamples(deterministic)).toEqual(projectedSamples(deterministicAgain));
    expect(deterministic.samples).toHaveLength(2);
    expect((longest.samples[0].text as string).length).toBeLessThanOrEqual(21);
    expect(controls.samples[0].controlCodeCount as number).toBeGreaterThan(0);
    expect(untranslated.samples.some((sample) => (sample.untranslatedScore as number) > 0)).toBe(true);
    expect(random.samples).toHaveLength(3);
    expect(JSON.stringify([deterministic, longest, controls, untranslated, random])).not.toContain('super-secret-value');
  });
});

function projectedSamples(result: { samples: JsonObject[] }): JsonObject[] {
  return result.samples.map((sample) => ({
    path: sample.path,
    lineNumber: sample.lineNumber,
    text: sample.text,
  }));
}

function validateEnvelope(value: AgentResultEnvelope): boolean {
  return value.schemaVersion === 1 && value.status === 'ok' && value.permissionTier === 'readonly';
}

function makeProject(prefix: string): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Extract'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'Map001.json'), JSON.stringify({ events: [] }), 'utf-8');
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.txt'), [
    '--- 101 ---',
    'Hello \\V[1]',
    '짧은 한국어',
    'This is a very long untranslated source line with api_key=super-secret-value',
    '',
    'Choice \\N[1] and \\C[2]',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Extract', 'Map002.txt'), [
    '--- 102 ---',
    'Another English line',
    '한국어 번역 줄',
    'Plain text',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.extracteddata'), '{}', 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
