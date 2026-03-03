import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { rmBom, getAllFileInDir, decodeEncoding } from '../../src/utils';

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
    (globalThis as any).WolfMetadata = { ver: -1 };
  });

  afterEach(() => {
    delete (globalThis as any).WolfMetadata;
  });

  it('decodes as Shift_JIS when WolfMetadata.ver is 2', () => {
    (globalThis as any).WolfMetadata = { ver: 2 };
    // 0x82 0xB1 0x82 0xF1 0x82 0xC9 0x82 0xBF 0x82 0xCD = "こんにちは" in Shift_JIS
    const buf = new Uint8Array([0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD]);
    const result = decodeEncoding(buf);
    expect(result).toBe('こんにちは');
  });

  it('decodes ASCII bytes as Shift_JIS when ver is 2', () => {
    (globalThis as any).WolfMetadata = { ver: 2 };
    const buf = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(decodeEncoding(buf)).toBe('Hello');
  });

  it('decodes as UTF-8 when WolfMetadata.ver is not 2', () => {
    (globalThis as any).WolfMetadata = { ver: 3 };
    const buf = new Uint8Array([0x48, 0x65, 0x6c]);
    expect(decodeEncoding(buf)).toBe('Hel');
  });

  it('decodes as UTF-8 when WolfMetadata.ver is -1', () => {
    (globalThis as any).WolfMetadata = { ver: -1 };
    const buf = new Uint8Array([0x41, 0x42, 0x43]);
    expect(decodeEncoding(buf)).toBe('ABC');
  });

  it('decodes UTF-8 multibyte characters when ver is 3', () => {
    (globalThis as any).WolfMetadata = { ver: 3 };
    // "가" in UTF-8 is 0xEA 0xB0 0x80
    const buf = new Uint8Array([0xEA, 0xB0, 0x80]);
    expect(decodeEncoding(buf)).toBe('가');
  });
});

describe('getAllFileInDir', () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-test-'));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns all files in a flat directory', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(dir, 'b.json'), '{}');

    const result = getAllFileInDir(dir);
    expect(result.sort()).toEqual([
      path.join(dir, 'a.txt'),
      path.join(dir, 'b.json'),
    ].sort());
  });

  it('filters by extension when ext is provided', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(dir, 'b.json'), '{}');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c');

    const result = getAllFileInDir(dir, '.txt');
    expect(result.sort()).toEqual([
      path.join(dir, 'a.txt'),
      path.join(dir, 'c.txt'),
    ].sort());
  });

  it('recursively traverses subdirectories', () => {
    const dir = makeTmpDir();
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'nested.txt'), 'n');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'f');

    const result = getAllFileInDir(dir);
    expect(result.sort()).toEqual([
      path.join(dir, 'file.txt'),
      path.join(sub, 'nested.txt'),
    ].sort());
  });

  it('returns empty array for empty directory', () => {
    const dir = makeTmpDir();
    const result = getAllFileInDir(dir);
    expect(result).toEqual([]);
  });

  it('filters by extension in nested directories', () => {
    const dir = makeTmpDir();
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'b.json'), '{}');
    fs.writeFileSync(path.join(sub, 'c.txt'), 'c');
    fs.writeFileSync(path.join(dir, 'a.json'), '{}');

    const result = getAllFileInDir(dir, '.json');
    expect(result.sort()).toEqual([
      path.join(dir, 'a.json'),
      path.join(sub, 'b.json'),
    ].sort());
  });

  it('handles deeply nested directories', () => {
    const dir = makeTmpDir();
    const deep = path.join(dir, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'deep.txt'), 'd');

    const result = getAllFileInDir(dir);
    expect(result).toEqual([path.join(deep, 'deep.txt')]);
  });

  it('returns no files when ext filter matches nothing', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');

    const result = getAllFileInDir(dir, '.json');
    expect(result).toEqual([]);
  });
});
