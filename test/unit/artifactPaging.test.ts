import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from '../../src/agent/agentService';
import { MAX_ARTIFACT_ITEM_BYTES } from '../../src/agent/artifactPaging';
import * as atomic from '../../src/ts/libs/atomicFile';
import type { JsonObject } from '../../src/types/agentWorkspace';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const parent = path.resolve('artifacts/unit/artifactPaging'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-')); roots.push(root);
  return { root, service: new AgentService({ projectRoot: root }) };
}

describe('bounded artifact creation and paging', () => {
  it('reads the default-limit many-line alignment that formerly produced an unreadable 19 MiB artifact', () => {
    const { root, service } = fixture();
    fs.writeFileSync(path.join(root, 'source.txt'), 'x\n'.repeat(130000));
    fs.writeFileSync(path.join(root, 'target.txt'), 'y\n'.repeat(130000));
    const alignment = service.alignment.inspect({ sourcePath: 'source.txt', targetPath: 'target.txt' });
    const ref = alignment.alignmentRef!;
    expect(fs.statSync(ref.target.path).size).toBeLessThan(64 * 1024);
    expect(service.dataRefs.readPage(ref.refId).summary).toMatchObject({ refs: { itemCount: 130001 } });
    const read = fs.readFileSync;
    const pageReads: string[] = [];
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (typeof file === 'string' && /\.pages[\\/]/.test(file)) pageReads.push(file);
      return Reflect.apply(read, fs, [file, ...args]);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const page = service.dataRefs.readPage(ref.refId, { collection: 'refs', offset: 4080, limit: 100 });
    expect(page.items).toEqual(alignment.refs.slice(4080, 4180));
    expect(pageReads.length).toBeGreaterThan(0);
    expect(pageReads.length).toBeLessThanOrEqual(2);
    expect(pageReads.reduce((sum, file) => sum + fs.statSync(file).size, 0)).toBeLessThanOrEqual(1024 * 1024);
    expect(page).toMatchObject({ total: 130001, nextOffset: 4180 });
    expect(service.dataRefs.readPage(ref.refId, { collection: 'refs', offset: 130000 })).toMatchObject({ items: alignment.refs.slice(-1), nextOffset: null });
  });

  it('keeps inline legacy JSON and paged results compatible with the same bounded public shape', () => {
    const { service } = fixture();
    const rows = Array.from({ length: 4200 }, (_, index) => ({ lineNumber: index + 1, message: index === 4199 ? 'api_key=private-test-secret' : 'safe' }));
    const artifact = service.artifacts.writeJsonArtifact('qa-score', 'large', { findings: rows });
    const ref = service.dataRefs.registerArtifactRef(artifact, { kind: 'qa-score' });
    const page = service.dataRefs.readPage(ref.refId, { collection: 'findings', offset: 4198, limit: 10 });
    expect(page).toMatchObject({ total: 4200, nextOffset: null });
    expect(page.items).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain('private-test-secret');
    const legacy = service.artifacts.writeJsonArtifact('qa-score', 'old', { findings: [{ lineNumber: 1 }] });
    // Old versions wrote formatted monolithic records, without storage metadata.
    fs.writeFileSync(legacy.path, JSON.stringify(legacy, null, 2));
    const oldRef = service.dataRefs.registerArtifactRef(legacy, { kind: 'qa-score' });
    expect(service.dataRefs.readPage(oldRef.refId, { collection: 'findings' }).items).toEqual([{ lineNumber: 1 }]);
  });

  it('does not publish a partial replacement and removes only its failed generation on disk failure', () => {
    const { service } = fixture();
    const previous = service.artifacts.writeJsonArtifact('qa-score', 'replace', { findings: ['original'] });
    const bytes = fs.readFileSync(previous.path);
    const write = atomic.atomicWriteTextFile;
    let writes = 0;
    vi.spyOn(atomic, 'atomicWriteTextFile').mockImplementation((...args) => {
      if (++writes === 2) throw new Error('disk full');
      return write(...args);
    });
    expect(() => service.artifacts.writeJsonArtifact('qa-score', 'replace', { findings: Array.from({ length: 4200 }, (_, i) => i) })).toThrow('disk full');
    expect(fs.readFileSync(previous.path)).toEqual(bytes);
    expect(fs.readdirSync(service.artifacts.artifactsRoot)).toEqual([path.basename(previous.path)]);
  });

  it('rejects oversized items and corrupt page coverage instead of returning incomplete success', () => {
    const { service } = fixture();
    expect(() => service.artifacts.writeJsonArtifact('qa-score', 'too-large', { findings: ['x'.repeat(MAX_ARTIFACT_ITEM_BYTES + 1)] })).toThrow('page byte budget');
    const artifact = service.artifacts.writeJsonArtifact('qa-score', 'corrupt', { findings: Array(4200).fill('x') });
    const ref = service.dataRefs.registerArtifactRef(artifact, { kind: 'qa-score' });
    const disk = JSON.parse(fs.readFileSync(artifact.path, 'utf8'));
    disk.storage.collections.findings.pages[0].count--;
    fs.writeFileSync(artifact.path, JSON.stringify(disk));
    expect(() => service.dataRefs.readPage(ref.refId, { collection: 'findings' })).toThrow('coverage');
  });

  it('preserves nested patch operation pagination and exact byte-budget continuation', () => {
    const { service } = fixture();
    const operations = Array.from({ length: 20 }, (_, i) => ({ id: i, text: 'x'.repeat(30000) }));
    const artifact = service.artifacts.writeJsonArtifact('patch-proposal', 'operations', { patch: { operations } });
    const ref = service.dataRefs.registerArtifactRef(artifact, { kind: 'patch-proposal' });
    let offset = 0;
    const received: JsonObject[] = [];
    do {
      const page = service.dataRefs.readPage(ref.refId, { collection: 'operations', offset, limit: 100 });
      received.push(...page.items as JsonObject[]);
      if (page.nextOffset === null) break;
      offset = page.nextOffset as number;
    } while (offset < operations.length);
    expect(received).toEqual(operations);
  });
});
