import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('renderer/preload IPC compile contract', () => {
  it('infers channel payloads/results and rejects wrong direction, name, and required arguments', async () => {
    const root = process.cwd();
    const compiler = path.join(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
    const project = path.join(root, 'test', 'fixtures', 'typescript', 'ipc-contracts', 'tsconfig.json');
    const result = await execFileAsync(process.execPath, [compiler, '--project', project, '--pretty', 'false'], {
      cwd: root, encoding: 'utf8',
    });
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
