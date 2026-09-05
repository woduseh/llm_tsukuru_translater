import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

function project(source: string, target: string): { service: AgentService; root: string } {
  const base = path.resolve('artifacts', 'unit', 'analysisCoverage');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'case-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'source.txt'), source);
  fs.writeFileSync(path.join(root, 'target.txt'), target);
  return { service: new AgentService({ projectRoot: root }), root };
}

const paths = { sourcePath: 'source.txt', targetPath: 'target.txt' };

describe('analysis evidence coverage', () => {
  it('does not certify matching prefixes when a later separator has drifted', () => {
    const prefix = '1234567890\n'.repeat(25000);
    const { service } = project(prefix + '--- 101 ---', prefix + '--- 999 ---');
    const partial = service.alignment.inspect(paths);
    expect(partial.score).toBe(1);
    expect(partial).toMatchObject({ coverage: 'partial', verified: false, confidence: 'low', scoreKind: 'observed-structural' });
    const full = service.alignment.inspect({ ...paths, maxBytes: 1024 * 1024 });
    expect(full).toMatchObject({ coverage: 'full', verified: true });
    expect(full.breaks.some((item) => item.code === 'separator-drift')).toBe(true);
  });

  it('blocks partial QA even with a zero threshold and errors disabled', () => {
    const { service } = project('1234567890\n'.repeat(20), '1234567890\n'.repeat(20));
    const score = service.qa.scoreFile({ ...paths, maxBytes: 30 });
    expect(score).toMatchObject({ coverage: 'partial', verified: false, confidence: 'low', scoreKind: 'structural-and-heuristic' });
    expect(service.qa.thresholdGate({ score, threshold: 0, blockOnErrors: false })).toMatchObject({ blocked: true, gate: 'blocked' });
    expect(service.qa.scoreBatch({ files: [{ ...paths, maxBytes: 30 }], threshold: 0 }).passed).toBe(false);
  });

  it('does not pass preservation gates without a source or any batch files', () => {
    const { service } = project('Hello', '안녕');
    const score = service.qa.scoreFile({ targetPath: paths.targetPath });
    expect(score).toMatchObject({ coverage: 'full', verified: false, confidence: 'low' });
    expect(service.qa.thresholdGate({ score, threshold: 0 }).blocked).toBe(true);
    expect(service.qa.scoreBatch({ files: [] }).passed).toBe(false);
    const full = service.qa.scoreFile(paths);
    expect(service.qa.thresholdGate({ score: full, threshold: 0 }).gate).toBe('passed');
  });

  it('checks metadata bounds beyond the twelve displayed sample spans', () => {
    const { service, root } = project('123\n'.repeat(20), '456\n'.repeat(20));
    const main = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i, { m: i === 12 ? 1000 : i + 1 }]));
    fs.writeFileSync(path.join(root, 'source.extracteddata'), JSON.stringify({ main }));
    const score = service.qa.scoreFile({ ...paths, metadataPath: 'source.extracteddata' });
    expect(score.findings.some((item) => item.code === 'metadata-span-out-of-range')).toBe(true);
    expect(score.alignment?.metadata).toMatchObject({ mappingValidated: false, maxEndLine: 1000 });
  });

  it('reports malformed metadata as unrecognized instead of hiding the inspection', () => {
    const { service, root } = project('Hello', '안녕');
    fs.writeFileSync(path.join(root, 'bad.extracteddata'), 'invalid');
    const score = service.qa.scoreFile({ ...paths, metadataPath: 'bad.extracteddata' });
    expect(score.findings.some((item) => item.code === 'metadata-unrecognized')).toBe(true);
  });
});
