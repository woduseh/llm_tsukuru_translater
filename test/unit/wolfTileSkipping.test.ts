import { describe, expect, it } from 'vitest';
import { AppContext } from '../../src/appContext';
import { wolfExtractMap } from '../../src/ts/wolf/parser/Map';
import { WolfParserIo } from '../../src/ts/wolf/parser/io';
import { makeWolfMap } from '../utils/wolfMapFixture';

function map(width: number, height: number, version: 2 | 3 = 3) {
  const base = makeWolfMap(['Hello %1\0', 'Second\nline\0'], version);
  const fields = 29 + base.readUInt32LE(25);
  const tileStart = fields + 16;
  const header = Buffer.from(base.subarray(0, tileStart));
  header.writeInt32LE(width, fields + 4);
  header.writeInt32LE(height, fields + 8);
  const tileBytes = Math.max(0, width * height * 12);
  return { fields, tileStart, bytes: Buffer.concat([header, Buffer.alloc(tileBytes, 0xab), base.subarray(tileStart + 12)]) };
}

describe('bounded skipping of unused Wolf map tiles', () => {
  it.each([2, 3] as const)('keeps v%s event strings and byte offsets after a large tile surface', version => {
    const small = map(1, 1, version), large = map(256, 256, version);
    const before = wolfExtractMap(small.bytes, new AppContext());
    const ctx = new AppContext(); const after = wolfExtractMap(large.bytes, ctx);
    expect(ctx.WolfMetadata.ver).toBe(version);
    const first = before.events[0].pages[0].cmd;
    const second = after.events[0].pages[0].cmd;
    expect(second.map(cmd => cmd.strArg[0].str)).toEqual(first.map(cmd => cmd.strArg[0].str));
    const offset = (256 * 256 - 1) * 12;
    expect(second[0].strArg[0].pos2).toBe(first[0].strArg[0].pos2 + offset);
    expect(large.bytes.subarray(second[0].strArg[0].pos2, second[0].strArg[0].pos3)).toEqual(second[0].strArg[0].str);
    expect(after.events[0].eventId).toBe(1);
  });

  it('rejects negative, overflowing, truncated tiles and missing footer data', () => {
    const fixture = map(1, 1);
    for (const [width, height] of [[-1, 1], [1, -1], [2147483647, 2147483647]]) {
      const bytes = Buffer.from(fixture.bytes);
      bytes.writeInt32LE(width, fixture.fields + 4); bytes.writeInt32LE(height, fixture.fields + 8);
      expect(() => wolfExtractMap(bytes, new AppContext())).toThrow();
    }
    expect(() => wolfExtractMap(fixture.bytes.subarray(0, fixture.tileStart + 8), new AppContext())).toThrow();
    expect(() => wolfExtractMap(fixture.bytes.subarray(0, -1), new AppContext())).toThrow();
  });

  it('does not advance the binary cursor when a skip is invalid', () => {
    const io = new WolfParserIo(Buffer.from([1, 2, 3, 4]));
    io.skipBytes(2);
    for (const amount of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, 3]) {
      expect(() => io.skipBytes(amount)).toThrow();
      expect(io.pointer).toBe(2);
    }
    expect(io.readU1()).toBe(3);
    io.skipBytes(1);
    expect(io.pointer).toBe(io.byteLen);
  });
});
