import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { commitCompletedOutput } from '../../src/ts/rpgmv/apply';

const sandboxRoot = path.resolve('artifacts', 'unit', 'mvApplyTransaction');
const createdDirs: string[] = [];
let sequence = 0;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MV/MZ instant apply transaction', () => {
  it('restores every live file when a later commit rename fails', () => {
    const root = path.join(sandboxRoot, `${process.pid}-${Date.now()}-${sequence++}`);
    const dataDir = path.join(root, 'data');
    const completedData = path.join(dataDir, 'Completed', 'data');
    const jsDir = path.join(root, 'js');
    fs.mkdirSync(completedData, { recursive: true });
    fs.mkdirSync(jsDir, { recursive: true });
    createdDirs.push(root);

    const firstPath = path.join(dataDir, 'Actors.json');
    const secondPath = path.join(dataDir, 'Items.json');
    fs.writeFileSync(firstPath, 'old-actors', 'utf8');
    fs.writeFileSync(secondPath, 'old-items', 'utf8');
    fs.writeFileSync(path.join(completedData, 'Actors.json'), 'new-actors', 'utf8');
    fs.writeFileSync(path.join(completedData, 'Items.json'), 'new-items', 'utf8');

    const originalRename = fs.renameSync.bind(fs);
    let injected = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (!injected
        && String(oldPath).includes('.apply-')
        && path.resolve(String(newPath)) === path.resolve(secondPath)) {
        injected = true;
        throw new Error('simulated second live commit failure');
      }
      return originalRename(oldPath, newPath);
    });

    expect(() => commitCompletedOutput(dataDir, jsDir, {
      'Actors.json': {},
      'Items.json': {},
    }, false)).toThrow(/simulated second live commit failure/);

    expect(injected).toBe(true);
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('old-actors');
    expect(fs.readFileSync(secondPath, 'utf8')).toBe('old-items');
    expect(fs.readdirSync(dataDir).filter(name => name.includes('.previous-') || name.includes('.apply-'))).toEqual([]);
  });
});
