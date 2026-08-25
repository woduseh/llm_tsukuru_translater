import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AtomicFilePreimageMismatchError, AtomicFileWriteError } from '../../src/ts/libs/atomicFile';
import { applyVerifiedJsonWrite } from '../../src/ts/rpgmv/verifyWrite';

const sandboxRoot = path.resolve('artifacts', 'unit', 'verifyWrite');
const createdDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const dir of createdDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('atomic JSON Verify writes', () => {
  it.each(['data', 'completed'])('writes a validated candidate inside the %s surface', (surface) => {
    const dataDir = makeDataDir();
    const targetDir = surface === 'data' ? dataDir : path.join(dataDir, 'Completed', 'data');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, 'Actors.json');
    const expectedContent = '{"name":"before"}';
    fs.writeFileSync(targetPath, expectedContent, 'utf8');

    applyVerifiedJsonWrite(dataDir, {
      fileName: 'Actors.json',
      targetPath,
      expectedContent,
      nextContent: '{"name":"after"}',
    });

    expect(JSON.parse(fs.readFileSync(targetPath, 'utf8'))).toEqual({ name: 'after' });
  });

  it('preserves a newer external edit when the preimage is stale', () => {
    const dataDir = makeDataDir();
    const targetPath = path.join(dataDir, 'Actors.json');
    fs.writeFileSync(targetPath, '{"name":"newer"}', 'utf8');

    let thrown: unknown;
    try {
      applyVerifiedJsonWrite(dataDir, {
        fileName: 'Actors.json',
        targetPath,
        expectedContent: '{"name":"older"}',
        nextContent: '{"name":"replacement"}',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AtomicFileWriteError);
    expect((thrown as AtomicFileWriteError).cause).toBeInstanceOf(AtomicFilePreimageMismatchError);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('{"name":"newer"}');
  });

  it('rejects paths outside the active data and Completed/data roots', () => {
    const dataDir = makeDataDir();
    const outsidePath = path.join(path.dirname(dataDir), 'outside.json');
    fs.writeFileSync(outsidePath, '{}', 'utf8');

    expect(() => applyVerifiedJsonWrite(dataDir, {
      fileName: 'outside.json',
      targetPath: outsidePath,
      expectedContent: '{}',
      nextContent: '{"changed":true}',
    })).toThrow(/허용된 번역 경로 밖/);
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('{}');
  });

  it('rejects invalid JSON before replacing the target', () => {
    const dataDir = makeDataDir();
    const targetPath = path.join(dataDir, 'Actors.json');
    fs.writeFileSync(targetPath, '{}', 'utf8');

    expect(() => applyVerifiedJsonWrite(dataDir, {
      fileName: 'Actors.json',
      targetPath,
      expectedContent: '{}',
      nextContent: '{broken',
    })).toThrow();
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('{}');
  });
});

function makeDataDir(): string {
  const root = path.join(sandboxRoot, `${process.pid}-${Date.now()}-${sequence++}`);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  createdDirs.push(root);
  return dataDir;
}
