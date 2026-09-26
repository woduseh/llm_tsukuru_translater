import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AgentSafeFileSystem } from '../../src/agent/agentSafeFileSystem';
import { SandboxPathError } from '../../src/agent/agentFileErrors';

const roots: string[] = [];
function makeRoot() {
  const parent = path.resolve('artifacts/unit/agentPathPortability');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'MixedCase-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'Extract'));
  fs.writeFileSync(path.join(root, 'Extract', 'Map001.txt'), 'Hello');
  return root;
}
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

it('keeps canonical I/O casing and accepts either separator in project-relative tool paths', () => {
  const root = makeRoot();
  const files = new AgentSafeFileSystem({ projectRoot: root });
  expect(files.projectRoot).toBe(fs.realpathSync.native(root));
  expect(files.readText('Extract/Map001.txt').text).toBe('Hello');
  expect(files.readText('Extract\\Map001.txt').text).toBe('Hello');
  expect(() => files.resolveAllowed('..\\outside\\secret.txt')).toThrow(SandboxPathError);
});

it.skipIf(process.platform === 'win32')('does not treat differently cased sibling directories as the same root', () => {
  const root = makeRoot();
  const sibling = root.toLowerCase();
  fs.mkdirSync(sibling, { recursive: true }); roots.push(sibling);
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'outside');
  expect(() => new AgentSafeFileSystem({ projectRoot: root }).readText(path.join(sibling, 'secret.txt'))).toThrow(SandboxPathError);
});
