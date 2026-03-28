import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { encode } from '@msgpack/msgpack';
import WolfExtDataParser from '../../src/ts/wolf/extract/wolfExtData';
import { AppContext } from '../../src/appContext';
import { FileIOError } from '../../src/ts/libs/fileIO';

describe('wolfExtData', () => {
  let tmpFile: string;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  function createTmpFile(): string {
    tmpFile = path.join(os.tmpdir(), `wolf-ext-${Date.now()}-${Math.random()}.bin`);
    return tmpFile;
  }

  it('rehydrates cached map binaries as Buffer instances after a roundtrip', () => {
    const file = createTmpFile();
    const ctx = new AppContext();
    ctx.WolfMetadata = { ver: 3 };
    ctx.WolfExtData = [{
      str: { pos1: 1, pos2: 2, pos3: 4, str: Uint8Array.from([65, 0]), len: 2 },
      sourceFile: 'Map001.mps',
      extractFile: 'Map001.txt',
      endsWithNull: false,
      textLineNumber: [0],
      codeStr: '',
    }];
    ctx.WolfCache = {
      'Map001.mps': Buffer.from([1, 2, 3, 4]),
    };

    WolfExtDataParser.create(file, ctx);

    const restored = new AppContext();
    WolfExtDataParser.read(file, restored);

    expect(Buffer.isBuffer(restored.WolfCache['Map001.mps'])).toBe(true);
    expect([...restored.WolfCache['Map001.mps']]).toEqual([1, 2, 3, 4]);
    expect(restored.WolfMetadata.ver).toBe(3);
    expect(restored.WolfExtData[0].sourceFile).toBe('Map001.mps');
  });

  it('rejects malformed payloads instead of accepting unchecked decoded data', () => {
    const file = createTmpFile();
    const invalidPayload = {
      ext: 'not-an-array',
      meta: { ver: 99 },
      cache: {},
    };
    fs.writeFileSync(file, zlib.deflateSync(Buffer.from(encode(invalidPayload))));

    expect(() => WolfExtDataParser.read(file, new AppContext())).toThrow(FileIOError);
  });
});
