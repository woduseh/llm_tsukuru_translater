import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

describe('security hardening regressions', () => {
  it('does not expose a raw log IPC channel from preload', () => {
    expect(readRepoFile('src', 'preload.ts')).not.toContain("'log'");
  });

  it('does not register a raw log handler in the main process tools handler', () => {
    expect(readRepoFile('src', 'ipc', 'toolsHandler.ts')).not.toMatch(/ipcMain\.on\('log'/);
  });

  it('does not use v-html in JsonVerifyPage', () => {
    expect(readRepoFile('src', 'renderer', 'views', 'JsonVerifyPage.vue')).not.toContain('v-html');
  });

  it('does not use v-html in LlmComparePage', () => {
    expect(readRepoFile('src', 'renderer', 'views', 'LlmComparePage.vue')).not.toContain('v-html');
  });

  it('does not keep debug_crash.log in the repository root', () => {
    expect(fs.existsSync(path.join(repoRoot, 'debug_crash.log'))).toBe(false);
  });
});
