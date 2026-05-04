import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService, type AgentProvenance } from '../../src/agent';

const sandboxRoot = path.resolve('artifacts', 'unit', 'glossaryMemoryService');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('project-local glossary service', () => {
  it('creates and searches glossary entries in .llm-tsukuru-agent\\glossary', () => {
    const service = makeService('glossary-create');

    const result = service.glossary.createEntry({
      termId: 'hero-name',
      sourceText: '勇者',
      preferredTranslation: '용사',
      forbiddenTranslations: ['영웅'],
      aliases: ['Hero'],
      speaker: 'Narrator',
      engineType: 'rpg-maker-mv',
      confidence: 0.9,
      examples: [{ source: '勇者が来た', translation: '용사가 왔다' }],
      sourceRefs: [{ kind: 'manual', path: 'Extract\\Map001.txt', lineNumber: 2 }],
      provenance: provenance(),
      lastValidatedAt: '2025-01-01T00:00:00.000Z',
    }, new Date('2025-01-01T00:00:00.000Z'));

    expect(result.conflicts).toEqual([]);
    expect(service.glossary.search({ query: 'Hero' }).map((entry) => entry.termId)).toEqual(['hero-name']);
    expect(fs.existsSync(path.join(service.descriptor.workspaceRoot, 'glossary', 'entries.json'))).toBe(true);
  });

  it('detects glossary conflicts deterministically', () => {
    const service = makeService('glossary-conflict');
    service.glossary.createEntry({
      termId: 'same-source-a',
      sourceText: '魔王',
      preferredTranslation: '마왕',
      aliases: ['Demon King'],
      provenance: provenance(),
    });

    const result = service.glossary.createEntry({
      termId: 'same-source-b',
      sourceText: '魔王',
      preferredTranslation: '마족왕',
      forbiddenTranslations: ['마족왕'],
      aliases: ['Demon King'],
      provenance: provenance(),
    });

    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual([
      'source-preferred-mismatch',
      'alias-overlap',
      'forbidden-preferred-overlap',
    ]);
  });

  it('validates preferred and forbidden glossary usage', () => {
    const service = makeService('glossary-validate');
    service.glossary.createEntry({
      termId: 'guild',
      sourceText: 'Guild',
      preferredTranslation: '길드',
      forbiddenTranslations: ['조합'],
      provenance: provenance(),
    });

    const result = service.glossary.validateUsage('Guild 안내문: 조합에 오신 것을 환영합니다.', { now: new Date('2025-01-01T00:00:00.000Z') });

    expect(result.findings.map((finding) => finding.code)).toEqual([
      'forbidden-translation-used',
      'preferred-translation-missing',
    ]);
    expect(result.matchedEntries.map((entry) => entry.termId)).toEqual(['guild']);
  });

  it('requires provenance for glossary entries', () => {
    const service = makeService('glossary-provenance');

    expect(() => service.glossary.createEntry({
      sourceText: '王国',
      preferredTranslation: '왕국',
      provenance: undefined as unknown as AgentProvenance,
    })).toThrow(/provenance/i);
  });
});

describe('project-local agent memory service', () => {
  it('writes, searches, updates, forgets, and summarizes memory entries', () => {
    const service = makeService('memory-crud');
    const written = service.memory.write({
      memoryId: 'voice-luna',
      type: 'character-voice',
      summary: 'Luna uses polite Korean sentence endings.',
      details: 'Prefer -요 endings for Luna in village scenes.',
      tags: ['Luna', 'voice'],
      confidence: 0.8,
      provenance: provenance(),
    }, new Date('2025-01-01T00:00:00.000Z'));

    expect(written.memoryId).toBe('voice-luna');
    expect(service.memory.search({ query: 'polite', type: 'character-voice' })).toHaveLength(1);

    service.memory.update('voice-luna', {
      summary: 'Luna uses gentle polite Korean sentence endings.',
      tags: ['Luna', 'voice', 'polite'],
      provenance: provenance('manual-update'),
    }, new Date('2025-01-01T00:01:00.000Z'));
    expect(service.memory.search({ tags: ['polite'] })).toHaveLength(1);

    const summary = service.memory.summarize();
    expect(summary.total).toBe(1);
    expect(summary.byType).toEqual({ 'character-voice': 1 });

    service.memory.forget('voice-luna', provenance('forget-test'), new Date('2025-01-01T00:02:00.000Z'));
    expect(service.memory.search({ query: 'Luna' })).toHaveLength(0);
    expect(service.memory.search({ query: 'Luna', includeForgotten: true })).toHaveLength(1);
    expect(fs.existsSync(path.join(service.descriptor.workspaceRoot, 'memory', 'entries.json'))).toBe(true);
  });

  it('redacts secret-like memory content before storage', () => {
    const service = makeService('memory-redaction');
    const entry = service.memory.write({
      memoryId: 'provider-failure',
      type: 'provider-failure-pattern',
      summary: 'Provider failed with api_key=super-secret-value',
      details: 'Bearer abcdefghijklmnop should never be stored.',
      provenance: provenance(),
    });

    const storeText = fs.readFileSync(path.join(service.descriptor.workspaceRoot, 'memory', 'entries.json'), 'utf-8');
    expect(entry.redaction.redacted).toBe(true);
    expect(storeText).not.toContain('super-secret-value');
    expect(storeText).not.toContain('abcdefghijklmnop');
    expect(storeText).toContain('[REDACTED]');
  });

  it('requires provenance for memory entries', () => {
    const service = makeService('memory-provenance');

    expect(() => service.memory.write({
      type: 'project-caveat',
      summary: 'Never alter line alignment.',
      provenance: undefined as unknown as AgentProvenance,
    })).toThrow(/provenance/i);
  });
});

function makeService(prefix: string): AgentService {
  const projectRoot = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(projectRoot, { recursive: true });
  cleanupDirs.push(projectRoot);
  return new AgentService({ projectRoot, engine: 'rpg-maker-mv' });
}

function provenance(source = 'unit-test'): AgentProvenance {
  return {
    source,
    createdBy: 'agent',
    sourceRefs: [{ kind: 'test', path: 'test\\unit\\glossaryMemoryService.test.ts' }],
  };
}
