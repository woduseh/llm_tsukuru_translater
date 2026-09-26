import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';
import { createMcpOfflineToolRegistry } from '../../src/mcp';
import type { AgentResultEnvelope, JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'dataRefService');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('analysis data references', () => {
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
  it('reads saved analysis through the public paginated artifact tool', () => {
    const service = new AgentService({ projectRoot: makeProject('pages') });
    const artifact = service.artifacts.writeJsonArtifact('qa-score', 'page-fixture', { findings: [{ code: 'one' }, { code: 'two' }], token: 'super-secret-value' });
    const ref = service.dataRefs.registerArtifactRef(artifact, { kind: 'qa-score' });
    const registry = createMcpOfflineToolRegistry(service);
    const read = registry.callTool('artifacts.read_ref', { refId: ref.refId, collection: 'findings', limit: 1 });
    expect(read.status).toBe('ok');
    expect(JSON.stringify(read)).not.toContain('super-secret-value');
    expect(validateEnvelope(read)).toBe(true);
    expect(read.payload?.nextOffset).toBe(1);
  });
  
});

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
