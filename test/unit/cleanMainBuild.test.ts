import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('removes obsolete main output without touching source or other build outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-clean-build-'));
  temporaryRoots.push(root);
  for (const file of ['dist-main/src/deleted.js', 'src/keep.ts', 'dist-renderer/index.html']) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'keep');
  }
  const script = path.resolve('scripts/clean-main.cjs');
  const run = () => vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    __dirname: path.join(root, 'scripts'),
    require: createRequire(script),
  });
  run();
  expect(fs.existsSync(path.join(root, 'dist-main'))).toBe(false);
  expect(fs.readFileSync(path.join(root, 'src/keep.ts'), 'utf8')).toBe('keep');
  expect(fs.readFileSync(path.join(root, 'dist-renderer/index.html'), 'utf8')).toBe('keep');
  expect(run).not.toThrow();
});
