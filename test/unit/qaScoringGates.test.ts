import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService, type AgentProvenance } from '../../src/agent';
import { createMcpReadonlyToolRegistry } from '../../src/mcp';
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
    expect(score.nextSuggestedCalls).toContain('qa.threshold_gate');
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

  it('blocks threshold gate for low QA and includes next calls', () => {
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
    expect(gate.nextSuggestedCalls).toEqual(expect.arrayContaining(['qa.explain_score', 'patch.propose']));
  });

  it('adds QA gate scaffolding to apply preview without changing apply execution', () => {
    const service = new AgentService({
      projectRoot: makeProject('apply-preview', ['--- 101 ---', 'Hello'], ['--- 999 ---', 'Hello']),
    });

    const gate = service.qa.thresholdGate({
      sourcePath: 'Source\\Map001.txt',
      targetPath: 'Translated\\Map001.txt',
      threshold: 0.9,
      includeApplyPreviewScaffold: true,
    });
    const preview = gate.applyPreview as JsonObject;
    const qaGate = preview.qaGate as JsonObject;

    expect(preview.dryRunOnly).toBe(true);
    expect(preview.applyExecutionChanged).toBe(false);
    expect(qaGate.gate).toBe('blocked');
    expect(qaGate.qualityScore).toBe(gate.qualityScore);
  });

  it('wires QA score and gate tools through the MCP read-only registry', () => {
    const registry = createMcpReadonlyToolRegistry(new AgentService({
      projectRoot: makeProject('mcp', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', '안녕 \\V[1]']),
    }));

    expect(registry.listTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'qa.score_file',
      'qa.score_batch',
      'qa.explain_score',
      'qa.read_score_ref',
      'qa.suggest_next_calls',
      'qa.threshold_gate',
      'qa.compare_versions',
    ]));

    const score = registry.callTool('qa.score_file', { sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt' });
    const gate = registry.callTool('qa.threshold_gate', { score: score.payload as JsonObject, threshold: 0.9 });

    expect(score.status).toBe('ok');
    expect(score.qualityScore).toBeGreaterThanOrEqual(0.9);
    const qaRef = ((score.payload as JsonObject).qaRef as JsonObject).refId as string;
    expect(registry.callTool('qa.read_score_ref', { refId: qaRef }).status).toBe('ok');
    expect(registry.callTool('qa.suggest_next_calls', { scoreRefId: qaRef }).nextSuggestedCalls).toContain('qa.threshold_gate');
    expect(gate.status).toBe('ok');
    expect((gate.payload as JsonObject).gate).toBe('passed');
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
