import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentService } from '../../src/agent/agentService';

const roots: string[] = [];
function fixture(source = '--- 101 ---\nHello', target = '--- 101 ---\n안녕') {
  const base = path.resolve('artifacts/unit/analysisSnapshots'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'case-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'source.txt'), source); fs.writeFileSync(path.join(root, 'target.txt'), target);
  return { root, service: new AgentService({ projectRoot: root }) };
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
const input = { sourcePath: 'source.txt', targetPath: 'target.txt' };

it('shares two bounded reads across QA and alignment and reloads on the next request', () => {
  const { root, service } = fixture();
  const reads = vi.spyOn(service.files, 'readText');
  const glossary = vi.spyOn(service.glossary, 'search');
  const first = service.qa.scoreFile(input);
  expect(first.verified).toBe(true);
  expect(reads.mock.calls.map(([file]) => file)).toEqual(['target.txt', 'source.txt']);
  expect(glossary).toHaveBeenCalledTimes(1);
  expect(first.qaRef).toBeTruthy();
  fs.writeFileSync(path.join(root, 'target.txt'), '--- 999 ---\n안녕');
  const changed = service.qa.scoreFile(input);
  expect(reads).toHaveBeenCalledTimes(4);
  expect(changed.findings.some(f => f.code === 'separator-drift')).toBe(true);
  expect(service.qa.thresholdGate({ score: changed }).gate).toBe('blocked');
});

it('reads memory once while retaining per-type limits and physical line numbers', () => {
  const { service } = fixture('--- 101 ---\n\nHello', '--- 101 ---\n\n안녕한다');
  service.memory.write({ type: 'character-voice', summary: '존댓말을 사용해요', provenance: {
    source: 'test', createdBy: 'user', sourceRefs: [{ kind: 'manual' }],
  } });
  const read = vi.spyOn(service.memory, 'readSnapshot');
  const score = service.qa.scoreFile(input);
  expect(read).toHaveBeenCalledTimes(1);
  expect(score.memory.total).toBe(1);
  expect(score.findings.find(f => f.code === 'style-memory-politeness-check')?.lineNumber).toBe(3);
});

it('never certifies partial or redacted snapshots after sharing them', () => {
  const { service } = fixture('Hello api_key=secret-value\n'.repeat(4), '안녕 api_key=secret-value\n'.repeat(4));
  const partial = service.qa.scoreFile({ ...input, maxBytes: 10 });
  expect(partial.verified).toBe(false);
  expect(service.qa.thresholdGate({ score: partial, threshold: 0 }).gate).toBe('blocked');
  const redacted = service.qa.scoreFile(input);
  expect(redacted.verified).toBe(false);
  expect(service.qa.thresholdGate({ score: redacted, threshold: 0 }).gate).toBe('blocked');
});
