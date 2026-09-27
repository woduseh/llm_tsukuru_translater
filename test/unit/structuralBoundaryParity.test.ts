import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentService } from '../../src/agent/agentService';
import { createMcpOfflineToolRegistry } from '../../src/mcp/readonlyTools';
import { validatePatchApplyProposalRequest } from '../../src/agent/mutationApprovalContracts';
import { validateTranslatedFileContent } from '../../src/ts/rpgmv/translator';
import { checkMismatch } from '../../src/renderer/compareUtils';
import type { TranslationPatch, JsonObject } from '../../src/types/agentWorkspace';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

// Independent expectations shared across real product boundaries, not copies of their regexes.
const cases = [
  ['Wolf separator changed', '--- 101-0 ---', '--- 999-0 ---', false],
  ['MV separator changed', '--- 101 ---', '--- 999 ---', false],
  ['separator introduced', 'Hello', '--- 101 ---', false],
  ['separator removed', '--- 101-0 ---', '안녕', false],
  ['separator whitespace changed', '--- 101 ---', '---101---', false],
  ['percent code changed', 'Hello %1', '안녕 %2', false],
  ['percent code removed', 'Hello %1', '안녕', false],
  ['control code order changed', 'Hello \\V[1] \\N[2]', '안녕 \\N[2] \\V[1]', false],
  ['long control parameter changed', `Hello \\V[${'1'.repeat(30)}]`, `안녕 \\V[${'2'.repeat(30)}]`, false],
  ['empty line filled', '', '안녕', false],
  ['line emptied', 'Hello', '', false],
  ['Wolf separator retained', '--- 101-0 ---', '--- 101-0 ---', true],
  ['normal translation with tokens', 'Hello %1 \\V[1]', '안녕 %1 \\V[1]', true],
  ['dashed prose is not a separator', '--- Hello ---', '--- 안녕 ---', true],
] as const;

describe('structural agreement across translation, review, QA and approval', () => {
  it.each(cases)('%s', (_label, before, after, valid) => {
    const base = path.resolve('artifacts/unit/structuralBoundaryParity');
    fs.mkdirSync(base, { recursive: true });
    const root = fs.mkdtempSync(path.join(base, 'case-'));
    roots.push(root);
    // Include a real dialogue after the tested line, even when that line is blank or metadata.
    const source = `${before}\nUnchanged text`;
    const target = `${after}\n변경 없는 텍스트`;
    fs.writeFileSync(path.join(root, 'source.txt'), source);
    fs.writeFileSync(path.join(root, 'target.txt'), target);
    const registry = createMcpOfflineToolRegistry(new AgentService({ projectRoot: root }));
    expect(validateTranslatedFileContent(source, target).ok).toBe(valid);
    expect(!checkMismatch(source.split('\n'), target.split('\n'))).toBe(valid);
    const qa = registry.callTool('qa.score_file', { sourcePath: 'source.txt', targetPath: 'target.txt' });
    expect(qa.status, qa.failure?.message).toBe('ok');
    expect(qa.payload?.gate).toBe(valid ? 'passed' : 'blocked');
    fs.writeFileSync(path.join(root, 'target.txt'), source);
    const proposed = registry.callTool('patch.propose', { targetPath: 'target.txt', operations: [
      { lineNumber: 1, originalText: before, replacementText: after },
    ] });
    expect(proposed.status, proposed.failure?.message).toBe('ok');
    expect((proposed.payload?.validation as JsonObject).valid).toBe(valid);
    const patch = proposed.payload?.patch as unknown as TranslationPatch;
    expect(validatePatchApplyProposalRequest({ schemaVersion: 1, requestId: 'parity', idempotencyKey: 'parity',
      toolName: 'patch.apply', patch }, { projectRoot: root }).ok).toBe(valid);
    expect(fs.readFileSync(path.join(root, 'target.txt'), 'utf8')).toBe(source);
  });
});
