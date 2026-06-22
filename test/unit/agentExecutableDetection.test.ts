import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectAgentExecutables,
  detectExecutableOnPath,
} from '../../src/agent/agentExecutableDetection';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-exe-detect-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeExecutable(name: string): string {
  const filePath = path.join(tmpRoot, name);
  fs.writeFileSync(filePath, '#!/bin/sh\n');
  return filePath;
}

describe('agent executable detection', () => {
  it('reports available when a candidate name resolves on PATH', () => {
    writeExecutable('codex');
    const result = detectExecutableOnPath(['codex.cmd', 'codex'], { PATH: tmpRoot });
    expect(result.status).toBe('available');
    expect(result.resolvedPath).toBe(path.join(tmpRoot, 'codex'));
  });

  it('reports missing when no candidate resolves', () => {
    const result = detectExecutableOnPath(['definitely-not-here.exe'], { PATH: tmpRoot });
    expect(result.status).toBe('missing');
    expect(result.resolvedPath).toBeUndefined();
  });

  it('honors candidate priority order', () => {
    writeExecutable('claude');
    const result = detectExecutableOnPath(['claude.cmd', 'claude.exe', 'claude'], { PATH: tmpRoot });
    expect(result.status).toBe('available');
    expect(result.resolvedPath).toBe(path.join(tmpRoot, 'claude'));
  });

  it('treats absolute candidate paths directly', () => {
    const abs = writeExecutable('tool-x');
    expect(detectExecutableOnPath([abs], { PATH: '' }).status).toBe('available');
    expect(detectExecutableOnPath([path.join(tmpRoot, 'nope')], { PATH: '' }).status).toBe('missing');
  });

  it('handles an empty or missing PATH without throwing', () => {
    expect(detectExecutableOnPath(['codex'], {}).status).toBe('missing');
    expect(detectExecutableOnPath([], { PATH: tmpRoot }).status).toBe('missing');
  });

  it('batch-detects presets and echoes ids, skipping malformed entries', () => {
    writeExecutable('codex');
    const result = detectAgentExecutables(
      [
        { id: 'codex', executableNames: ['codex.cmd', 'codex'] },
        { id: 'claude', executableNames: ['claude.cmd', 'claude'] },
        { id: 'bad-entry' },
        null,
        'nope',
      ],
      { PATH: tmpRoot },
    );
    expect(result.schemaVersion).toBe(1);
    expect(result.results).toEqual([
      { id: 'codex', status: 'available' },
      { id: 'claude', status: 'missing' },
    ]);
  });

  it('returns an empty result set for non-array input', () => {
    expect(detectAgentExecutables(undefined).results).toEqual([]);
    expect(detectAgentExecutables({} as unknown).results).toEqual([]);
  });
});
