import { describe, it, expect, afterEach } from 'vitest';
import { read, write, exists } from '../../src/ts/rpgmv/edtool';
import os from 'os';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import iconv from 'iconv-lite';

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
      main: {
        'Map001.json': {
          data: {
            '1': { val: 'events.1.pages.0.list.0.parameters.0', m: 2, origin: 'Map001.json' },
            '3': { val: 'events.1.pages.0.list.1.parameters.0', m: 4, origin: 'Map001.json' },
          },
        },
      },
    };

    write(dir, sampleData);
    const result = read(dir);

    // read() unwraps the {dat: ...} wrapper and preserves per-file extraction metadata
    expect(result.main['Map001.json'].data['1'].val).toBe('events.1.pages.0.list.0.parameters.0');
    expect(result.main['Map001.json'].data['3'].m).toBe(4);
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

  it('read rejects malformed extracted metadata instead of returning unchecked data', () => {
    const dir = createTmpDir();
    const invalidPayload = {
      dat: {
        main: {
          'Map001.json': {
            data: {
              '1': { val: 42, m: 'two' },
            },
          },
        },
      },
    };
    const encoded = iconv.encode(JSON.stringify(invalidPayload), 'utf8');
    fs.writeFileSync(path.join(dir, '.extracteddata'), zlib.deflateSync(encoded));

    expect(() => read(dir)).toThrow(/Invalid \.extracteddata/);
  });
});
