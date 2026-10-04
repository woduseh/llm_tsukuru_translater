import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentService } from '../../src/agent/agentService';
import { AgentWorkspaceStorage } from '../../src/agent/agentWorkspaceStorage';
import { createMcpOfflineToolRegistry } from '../../src/mcp/readonlyTools';

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const parent = path.resolve('artifacts/unit/agentWorkspaceStorage');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  fixtures.push(root);
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'keep external bytes');
  return { project, outside, workspace: path.join(project, '.llm-tsukuru-agent') };
}

function linkDirectory(target: string, link: string) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('project-owned agent workspace storage', () => {
  it('rejects an existing external workspace link without reading or writing its contents', () => {
    const f = fixture();
    linkDirectory(f.outside, f.workspace);
    expect(() => new AgentService({ projectRoot: f.project })).toThrow(/escapes/);
    expect(fs.readdirSync(f.outside)).toEqual(['sentinel.txt']);
    expect(fs.readFileSync(path.join(f.outside, 'sentinel.txt'), 'utf-8')).toBe('keep external bytes');
  });

  it.each(['artifacts', 'audit', 'manifests', 'mcp', 'glossary', 'memory', 'terminal-sessions'])
    ('rejects an external %s directory introduced after construction', (directory) => {
      const f = fixture();
      const storage = new AgentWorkspaceStorage(f.project);
      fs.mkdirSync(f.workspace);
      linkDirectory(f.outside, path.join(f.workspace, directory));
      expect(() => storage.resolve(`${directory}/sentinel.txt`)).toThrow(/escapes/);
      expect(() => storage.writeJson(`${directory}/new.json`, { value: 'unsafe' })).toThrow(/escapes/);
      expect(() => storage.appendText(`${directory}/sentinel.txt`, 'unsafe')).toThrow(/escapes/);
      expect(fs.readdirSync(f.outside)).toEqual(['sentinel.txt']);
      expect(fs.readFileSync(path.join(f.outside, 'sentinel.txt'), 'utf-8')).toBe('keep external bytes');
    });

  it('keeps an offline analysis call from writing through an artifacts junction', () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.project, 'source.txt'), 'Hello');
    fs.writeFileSync(path.join(f.project, 'target.txt'), '안녕');
    const service = new AgentService({ projectRoot: f.project });
    const registry = createMcpOfflineToolRegistry(service);
    fs.mkdirSync(f.workspace);
    linkDirectory(f.outside, path.join(f.workspace, 'artifacts'));
    const result = registry.callTool('qa.score_file', { sourcePath: 'source.txt', targetPath: 'target.txt' });
    expect(result.status).toBe('failed');
    expect(result.failure?.message).toMatch(/escapes/);
    expect(fs.readdirSync(f.outside)).toEqual(['sentinel.txt']);
    expect(fs.readFileSync(path.join(f.project, 'target.txt'), 'utf-8')).toBe('안녕');
  });

  it('rejects linked glossary and data-ref stores on their real read paths', () => {
    const f = fixture();
    const service = new AgentService({ projectRoot: f.project });
    fs.mkdirSync(f.workspace);
    linkDirectory(f.outside, path.join(f.workspace, 'glossary'));
    linkDirectory(f.outside, path.join(f.workspace, 'mcp'));
    expect(() => service.glossary.search()).toThrow(/escapes/);
    expect(() => service.dataRefs.listRefs()).toThrow(/escapes/);
    expect(fs.readdirSync(f.outside)).toEqual(['sentinel.txt']);
  });

  it('allows ordinary workspace storage without materializing it during construction', () => {
    const f = fixture();
    const storage = new AgentWorkspaceStorage(f.project);
    expect(fs.existsSync(f.workspace)).toBe(false);
    storage.writeJson('manifests/proof.json', { saved: true });
    storage.appendText('audit/proof.jsonl', 'first\n');
    storage.appendText('audit/proof.jsonl', 'second\n');
    expect(JSON.parse(fs.readFileSync(storage.resolve('manifests/proof.json'), 'utf-8'))).toEqual({ saved: true });
    expect(fs.readFileSync(storage.resolve('audit/proof.jsonl'), 'utf-8')).toBe('first\nsecond\n');
  });
});
