import { describe, it, expect, afterEach } from 'vitest';
import { read, write, exists } from '../../src/ts/rpgmv/edtool';
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('edtool', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      const file = path.join(tmpDir, '.extracteddata');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    }
  });

  function createTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edtool-test-'));
    return tmpDir;
  }

  it('write and read roundtrip preserves data', () => {
    const dir = createTmpDir();
    const sampleData = {
      main: true,
      data: {
        '1': { val: 'events.1.pages.0.list.0.parameters.0', m: 2, origin: 'Map001.json' },
        '3': { val: 'events.1.pages.0.list.1.parameters.0', m: 4, origin: 'Map001.json' },
      },
    };

    write(dir, sampleData);
    const result = read(dir);

    // read() unwraps the {dat: ...} wrapper
    expect(result.main).toBe(true);
    expect(result.data['1'].val).toBe('events.1.pages.0.list.0.parameters.0');
    expect(result.data['3'].m).toBe(4);
  });

  it('exists returns true when .extracteddata file is present', () => {
    const dir = createTmpDir();
    const sampleData = { main: true, data: {} };
    write(dir, sampleData);
    expect(exists(dir)).toBe(true);
  });

  it('exists returns false when .extracteddata file is absent', () => {
    const dir = createTmpDir();
    expect(exists(dir)).toBe(false);
  });
});
