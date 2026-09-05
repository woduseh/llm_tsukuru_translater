import { describe, it, expect, beforeEach } from 'vitest';
import { rmBom } from '../../src/ts/libs/fileIO';
import { decodeEncoding } from '../../src/utils';
import { appCtx } from '../../src/appContext';

describe('rmBom', () => {
  it('removes BOM from string that starts with BOM', () => {
    const withBom = '\uFEFFhello world';
    expect(rmBom(withBom)).toBe('hello world');
  });

  it('returns string unchanged when no BOM present', () => {
    expect(rmBom('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(rmBom('')).toBe('');
  });

  it('only removes leading BOM, not BOM in middle of string', () => {
    const text = 'hello\uFEFFworld';
    expect(rmBom(text)).toBe('hello\uFEFFworld');
  });

  it('removes BOM from string that is only BOM', () => {
    expect(rmBom('\uFEFF')).toBe('');
  });
});

describe('decodeEncoding', () => {
  beforeEach(() => {
    appCtx.WolfMetadata = { ver: -1 };
  });

  it('decodes as Shift_JIS when WolfMetadata.ver is 2', () => {
    appCtx.WolfMetadata = { ver: 2 };
    // 0x82 0xB1 0x82 0xF1 0x82 0xC9 0x82 0xBF 0x82 0xCD = "こんにちは" in Shift_JIS
    const buf = new Uint8Array([0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD]);
    const result = decodeEncoding(buf, appCtx.WolfMetadata);
    expect(result).toBe('こんにちは');
  });

  it('decodes ASCII bytes as Shift_JIS when ver is 2', () => {
    appCtx.WolfMetadata = { ver: 2 };
    const buf = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(decodeEncoding(buf, appCtx.WolfMetadata)).toBe('Hello');
  });

  it('decodes as UTF-8 when WolfMetadata.ver is not 2', () => {
    appCtx.WolfMetadata = { ver: 3 };
    const buf = new Uint8Array([0x48, 0x65, 0x6c]);
    expect(decodeEncoding(buf, appCtx.WolfMetadata)).toBe('Hel');
  });

  it('decodes as UTF-8 when WolfMetadata.ver is -1', () => {
    appCtx.WolfMetadata = { ver: -1 };
    const buf = new Uint8Array([0x41, 0x42, 0x43]);
    expect(decodeEncoding(buf, appCtx.WolfMetadata)).toBe('ABC');
  });

  it('decodes UTF-8 multibyte characters when ver is 3', () => {
    appCtx.WolfMetadata = { ver: 3 };
    // "가" in UTF-8 is 0xEA 0xB0 0x80
    const buf = new Uint8Array([0xEA, 0xB0, 0x80]);
    expect(decodeEncoding(buf, appCtx.WolfMetadata)).toBe('가');
  });
});
