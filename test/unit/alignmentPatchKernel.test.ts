import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentService } from '../../src/agent';
import { createMcpReadonlyToolRegistry } from '../../src/mcp';
import type { JsonObject, TranslationPatch } from '../../src/types/agentWorkspace';

const sandboxRoot = path.resolve('artifacts', 'unit', 'alignmentPatchKernel');
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('alignment and patch dry-run kernel', () => {
  it('detects separator drift', () => {
    const projectRoot = makeProject('separator', [
      '--- 101 ---',
      'Hello \\V[1]',
      '',
      '--- 102 ---',
    ], [
      '--- 101 ---',
      '안녕 \\V[1]',
      '',
      '--- 999 ---',
    ]);
    const service = new AgentService({ projectRoot });

    const result = service.alignment.findBreaks({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt' });
    const breaks = result.breaks as JsonObject[];

    expect(breaks.some((entry) => entry.code === 'separator-drift')).toBe(true);
    expect(result.score as number).toBeLessThan(1);
  });

  it('detects empty line drift', () => {
    const service = new AgentService({
      projectRoot: makeProject('empty', ['--- 101 ---', 'Hello', '', 'World'], ['--- 101 ---', '안녕', '빈 줄 아님', 'World']),
    });

    const result = service.alignment.findBreaks({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt' });
    const breaks = result.breaks as JsonObject[];

    expect(breaks.some((entry) => entry.code === 'empty-line-drift')).toBe(true);
  });

  it('detects RPG control-code drift', () => {
    const service = new AgentService({
      projectRoot: makeProject('control', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', '안녕']),
    });

    const result = service.alignment.findBreaks({ sourcePath: 'Source\\Map001.txt', targetPath: 'Translated\\Map001.txt' });
    const breaks = result.breaks as JsonObject[];

    expect(breaks.some((entry) => entry.code === 'control-code-drift')).toBe(true);
  });

  it('previews a valid same-line patch without mutating the file', () => {
    const projectRoot = makeProject('patch-preview', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', 'Hello \\V[1]']);
    const service = new AgentService({ projectRoot });
    const before = fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8');

    const proposed = service.patch.propose({
      targetPath: 'Translated\\Map001.txt',
      lineNumber: 2,
      replacementText: '안녕 \\V[1]',
    });
    const preview = service.patch.preview(proposed.patch);

    expect(proposed.validation.valid).toBe(true);
    expect(preview.dryRunOnly).toBe(true);
    expect(preview.lineCountBefore).toBe(2);
    expect(preview.lineCountAfter).toBe(2);
    expect(preview.hunks[0].after).toBe('안녕 \\V[1]');
    expect(fs.readFileSync(path.join(projectRoot, 'Translated', 'Map001.txt'), 'utf-8')).toBe(before);
  });

  it('rejects line-count-changing patch proposals', () => {
    const service = new AgentService({
      projectRoot: makeProject('patch-reject', ['--- 101 ---', 'Hello'], ['--- 101 ---', 'Hello']),
    });

    const proposed = service.patch.propose({
      targetPath: 'Translated\\Map001.txt',
      lineNumber: 2,
      replacementText: '안녕\n추가 줄',
    });

    expect(proposed.validation.valid).toBe(false);
    expect(proposed.validation.lineCountPreserved).toBe(false);
    expect(proposed.validation.findings.some((entry) => entry.code === 'line-count-changing-replacement')).toBe(true);
  });

  it('wires alignment and patch dry-run tools through the MCP read-only registry', () => {
    const projectRoot = makeProject('mcp', ['--- 101 ---', 'Hello \\V[1]'], ['--- 101 ---', 'Hello \\V[1]']);
    const registry = createMcpReadonlyToolRegistry(new AgentService({ projectRoot }));

    expect(registry.listTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'alignment.inspect',
      'alignment.find_breaks',
      'alignment.score',
      'alignment.explain',
      'patch.propose',
      'patch.validate',
      'patch.preview',
    ]));

    const proposed = registry.callTool('patch.propose', {
      targetPath: 'Translated\\Map001.txt',
      lineNumber: 2,
      replacementText: '안녕 \\V[1]',
    });
    const patch = ((proposed.payload as JsonObject).patch as unknown) as TranslationPatch;
    const preview = registry.callTool('patch.preview', { patch });

    expect(proposed.status).toBe('ok');
    expect(preview.status).toBe('ok');
    expect(((preview.payload as JsonObject).validation as JsonObject).valid).toBe(true);
  });
});

function makeProject(prefix: string, sourceLines: string[], targetLines: string[]): string {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, 'Source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Translated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Source', 'Map001.txt'), sourceLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Translated', 'Map001.txt'), targetLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'Source', 'Map001.extracteddata'), JSON.stringify({
    2: { val: 'events.1.pages.0.list.0.parameters.0', m: 3, origin: 'Map001.json' },
  }), 'utf-8');
  return root;
}

function makeDir(prefix: string): string {
  const dir = path.join(sandboxRoot, `${prefix}-${process.pid}-${Date.now()}-${sequence++}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}
