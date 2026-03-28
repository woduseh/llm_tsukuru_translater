import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const repoRoot = process.cwd();
const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

function runFixtureTsc(fixtureName: string) {
  const fixtureTsconfig = path.join(
    repoRoot,
    'test',
    'fixtures',
    'typescript',
    fixtureName,
    'tsconfig.json',
  );

  return spawnSync(
    process.execPath,
    [tscBin, '--project', fixtureTsconfig, '--pretty', 'false'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

describe('post-release cleanup regressions', () => {
  it('compiles metadata validation without ambient Wolf globals', () => {
    const result = runFixtureTsc('metadata-validation-isolated');

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('allows legacy extracted metadata entries without a type marker', () => {
    const result = runFixtureTsc('legacy-extracted-data-entry');

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('does not redundantly overwrite themeList after applying validated settings', () => {
    const settingsHandler = fs.readFileSync(
      path.join(repoRoot, 'src', 'ipc', 'settingsHandler.ts'),
      'utf8',
    );

    expect(settingsHandler).not.toContain('ctx.settings.themeList = Object.keys(Themes)');
  });
});
