import { describe, expect, it } from 'vitest';
import path from 'path';
import { execFile } from 'child_process';

const repoRoot = process.cwd();
const tscBin = path.join(repoRoot, 'node_modules', '@typescript', 'native', 'bin', 'tsc');

function runFixtureTsc(fixtureName: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const fixtureTsconfig = path.join(
    repoRoot,
    'test',
    'fixtures',
    'typescript',
    fixtureName,
    'tsconfig.json',
  );

  return new Promise((resolve) => {
    execFile(process.execPath, [tscBin, '--project', fixtureTsconfig, '--pretty', 'false'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }, (error, stdout, stderr) => resolve({
      status: typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
        ? (error as NodeJS.ErrnoException).code as number
        : error ? 1 : 0,
      stdout,
      stderr,
    }));
  });
}

describe('post-release cleanup regressions', () => {
  it.concurrent('compiles metadata validation without ambient Wolf globals', async ({ expect }) => {
    const result = await runFixtureTsc('metadata-validation-isolated');

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it.concurrent('allows legacy extracted metadata entries without a type marker', async ({ expect }) => {
    const result = await runFixtureTsc('legacy-extracted-data-entry');

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

});
