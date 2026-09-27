import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent/agentService';
import type { AgentProvenance } from '../../src/agent/glossaryService';
import { createMcpOfflineToolRegistry } from '../../src/mcp';
import type { JsonObject } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'qaScoringGates');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('deterministic QA scoring gates', () => {
  it('scores a well-aligned translated file highly', () => {
    const service = new AgentService({
      projectRoot: makeProject('perfect', [
        '--- 101 ---',
        'Alice: こんにちは \\V[1] {PLAYER}',
        '',
        'Use item %s',
      ], [
        '--- 101 ---',
        'Alice: 안녕하세요 \\V[1] {PLAYER}',
        '',
        '아이템 %s 사용',
      ]),
    });

    const score = service.qa.scoreFile({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      metadataPath: 'Source\\Map001.extracteddata',
    });

    expect(score.qualityScore).toBeGreaterThanOrEqual(0.9);
    expect(score.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(score.qaRef?.kind).toBe('qa-score');
  });

  it('lowers score for separator and control-code drift', () => {
    const service = new AgentService({
      projectRoot: makeProject('drift', [
        '--- 101 ---',
        'Hello \\V[1]',
      ], [
        '--- 999 ---',
        '안녕',
      ]),
    });

    const score = service.qa.scoreFile({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt' });

    expect(score.qualityScore).toBeLessThan(1);
    expect(score.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'separator-drift',
      'control-code-drift',
    ]));
  });

  it('lowers score for glossary inconsistency', () => {
    const service = new AgentService({
      projectRoot: makeProject('glossary', ['Guild notice'], ['조합 안내문']),
    });
    service.glossary.createEntry({
      termId: 'guild',
      sourceText: 'Guild',
      preferredTranslation: '길드',
      forbiddenTranslations: ['조합'],
      provenance: provenance(),
    });

    const score = service.qa.scoreFile({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt' });

    expect(score.qualityScore).toBeLessThan(1);
    expect(score.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'preferred-glossary-missing',
      'forbidden-glossary-used',
    ]));
  });

  it('blocks threshold gate for low QA', () => {
    const service = new AgentService({
      projectRoot: makeProject('gate', ['--- 101 ---', 'Hello \\V[1]'], ['--- 999 ---', 'Hello']),
    });

    const gate = service.qa.thresholdGate({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 0.9,
    });

    expect(gate.blocked).toBe(true);
    expect(gate.gate).toBe('blocked');
    expect(gate.qualityScore).toBeLessThan(0.9);
  });
  it('returns the QA gate and paginated findings through the public tool', () => {
    const registry = createMcpOfflineToolRegistry(new AgentService({
      projectRoot: makeProject('mcp', ['--- 101 ---', 'Hello'], ['--- 101 ---', '안녕']),
    }));
    const score = registry.callTool('qa.score_file', { sourcePath: 'Source/Map001.txt', targetPath: 'Translated/Map001.txt' });
    expect(score.status).toBe('ok');
    expect(score.payload?.structuralScore).toBeGreaterThanOrEqual(0.9);
    expect(score.payload?.gate).toBe('passed');
    expect(score.payload?.semanticQuality).toBe('not-evaluated');
    const qaRef = (score.payload?.qaRef as JsonObject).refId as string;
    expect(registry.callTool('artifacts.read_ref', { refId: qaRef, collection: 'findings' }).status).toBe('ok');
  });
});

function makeProject(prefix: string, sourceLines: string[], targetLines: string[]): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Source', 'Map001.txt'), sourceLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Source', 'Map001.extracteddata'), JSON.stringify({
    2: { val: 'events.1.pages.0.list.1.parameters.0', m: 3, origin: 'Map001.json' },
  }), 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

function provenance(source = 'unit-test'): AgentProvenance {
  return {
    source,
    createdBy: 'agent',
    sourceRefs: [{ kind: 'test', path: 'test\\unit\\qaScoringGates.test.ts' }],
  };
}
