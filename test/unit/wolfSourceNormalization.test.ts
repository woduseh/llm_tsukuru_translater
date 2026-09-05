import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { normalizeWolfSources } from '../../src/ts/wolf/apply/applyWolf';
import type { WolfProjectPaths } from '../../src/ts/wolf/paths';
import type { extData } from '../../src/ts/wolf/types';

describe('Wolf source normalization', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wolf-normalize-')) {
        throw new Error(`unsafe Wolf normalization cleanup target: ${resolved}`);
      }
      if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  function makeProject(): WolfProjectPaths {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-normalize-'));
    temporaryRoots.push(root);
    const projectRoot = fs.realpathSync(root);
    const dataDir = path.join(projectRoot, 'Data');
    fs.mkdirSync(dataDir);
    return { projectRoot, dataDir, extractRoot: path.join(projectRoot, '_Extract') };
  }

  function writeSource(paths: WolfProjectPaths, name = 'Map001.mps'): { diskPath: string; bytes: Buffer } {
    const text = Buffer.from('First\n\nEnd\0', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(text.length);
    const bytes = Buffer.concat([header, text]);
    const diskPath = path.join(paths.dataDir, name);
    fs.writeFileSync(diskPath, bytes);
    return { diskPath, bytes };
  }

  function makeEntry(sourceFile: string): extData {
    const text = Uint8Array.from(Buffer.from('First\n\nEnd\0', 'utf8'));
    return {
      sourceFile,
      extractFile: 'map',
      str: { pos1: 0, pos2: 4, pos3: 4 + text.length, str: text, len: text.length },
      textLineNumber: [1, 2, 3],
      endsWithNull: true,
      codeStr: '101-0',
    };
  }

  it('resolves each distinct raw source only once across cache and repeated text entries', () => {
    const paths = makeProject();
    const first = writeSource(paths);
    const second = writeSource(paths, 'Map002.mps');
    const cache = { 'Data/Map001.mps': first.bytes, 'Data/Map002.mps': second.bytes };
    const entries = Array.from({ length: 40 }, (_, index) => makeEntry(`Data/Map00${index % 2 + 1}.mps`));
    const realpath = vi.spyOn(fs, 'realpathSync');

    const normalized = normalizeWolfSources(entries, cache, paths);

    // Each unique raw source still checks project root, Data root, and source.
    expect(realpath).toHaveBeenCalledTimes(2 * 3);
    expect(normalized.ext).toHaveLength(entries.length);
    expect(normalized.ext.map((entry) => entry.sourceFile)).toEqual(entries.map((entry) => entry.sourceFile));
    expect(normalized.diskPaths).toEqual({
      'Data/Map001.mps': first.diskPath,
      'Data/Map002.mps': second.diskPath,
    });
  });

  it('validates raw aliases separately while preserving metadata and independent byte copies', () => {
    const paths = makeProject();
    const source = writeSource(paths);
    const aliases = ['Data/Map001.mps', 'Map001.mps', source.diskPath];
    const cache = Object.fromEntries(aliases.map((alias) => [alias, Buffer.from(source.bytes)]));
    const entries = [...aliases, ...aliases].map(makeEntry);
    const originalEntries = entries.map((entry) => ({
      ...entry,
      str: { ...entry.str, str: Uint8Array.from(entry.str.str) },
      textLineNumber: [...entry.textLineNumber],
    }));
    const originalCache = Object.fromEntries(Object.entries(cache).map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const realpath = vi.spyOn(fs, 'realpathSync');

    const normalized = normalizeWolfSources(entries, cache, paths);

    expect(realpath).toHaveBeenCalledTimes(aliases.length * 3);
    expect(Object.keys(normalized.cache)).toEqual(['Data/Map001.mps']);
    expect(normalized.cache['Data/Map001.mps']).toEqual(source.bytes);
    expect(normalized.ext).toEqual(entries.map((entry) => ({
      ...entry,
      sourceFile: 'Data/Map001.mps',
      str: { ...entry.str, str: Buffer.from(entry.str.str) },
    })));
    expect(normalized.diskPaths).toEqual({ 'Data/Map001.mps': source.diskPath });

    normalized.cache['Data/Map001.mps'][0] ^= 0xff;
    normalized.ext[0].str.str[0] ^= 0xff;
    normalized.ext[0].textLineNumber[0] = 999;
    expect(entries).toEqual(originalEntries);
    expect(cache).toEqual(originalCache);
    expect(normalized.ext[1].str.str).toEqual(Buffer.from(originalEntries[1].str.str));
    expect(normalized.ext[1].textLineNumber).toEqual(originalEntries[1].textLineNumber);
  });

  it('rejects conflicting cached bytes when different raw aliases resolve to one source', () => {
    const paths = makeProject();
    const source = writeSource(paths);
    const changed = Buffer.from(source.bytes);
    changed[changed.length - 1] ^= 0xff;
    const realpath = vi.spyOn(fs, 'realpathSync');

    expect(() => normalizeWolfSources([makeEntry('Data/Map001.mps')], {
      'Data/Map001.mps': source.bytes,
      'Map001.mps': changed,
    }, paths)).toThrow(/Wolf cache 경로가 충돌/);

    expect(realpath).toHaveBeenCalledTimes(2 * 3);
    expect(fs.readFileSync(source.diskPath)).toEqual(source.bytes);
  });

  it.each(['deleted', 'directory'] as const)('revalidates a source that is %s before a later call', (replacement) => {
    const paths = makeProject();
    const source = writeSource(paths);
    const cache = { 'Data/Map001.mps': source.bytes };
    const entries = [makeEntry('Data/Map001.mps')];
    normalizeWolfSources(entries, cache, paths);
    fs.unlinkSync(source.diskPath);
    if (replacement === 'directory') fs.mkdirSync(source.diskPath);

    expect(() => normalizeWolfSources(entries, cache, paths)).toThrow(
      replacement === 'deleted' ? /원본 데이터 파일이 없습니다/ : /일반 파일이 아닙니다/,
    );
  });

  it('does not reuse a resolved path across projects with the same raw source name', () => {
    const firstPaths = makeProject();
    const secondPaths = makeProject();
    const firstSource = writeSource(firstPaths);
    const secondSource = writeSource(secondPaths);
    const entries = [makeEntry('Data/Map001.mps')];

    const first = normalizeWolfSources(entries, { 'Data/Map001.mps': firstSource.bytes }, firstPaths);
    const second = normalizeWolfSources(entries, { 'Data/Map001.mps': secondSource.bytes }, secondPaths);

    expect(first.diskPaths['Data/Map001.mps']).toBe(firstSource.diskPath);
    expect(second.diskPaths['Data/Map001.mps']).toBe(secondSource.diskPath);
    expect(second.diskPaths['Data/Map001.mps']).not.toBe(first.diskPaths['Data/Map001.mps']);
  });

  it.each(['relative', 'absolute'] as const)('rejects a later %s source outside Data after resolving a valid source', (style) => {
    const paths = makeProject();
    const source = writeSource(paths);
    const outsidePath = path.join(paths.projectRoot, 'Outside.mps');
    fs.writeFileSync(outsidePath, source.bytes);
    const outsideSource = style === 'absolute' ? outsidePath : '../Outside.mps';

    expect(() => normalizeWolfSources([
      makeEntry('Data/Map001.mps'),
      makeEntry(outsideSource),
    ], { 'Data/Map001.mps': source.bytes }, paths)).toThrow(/Data 폴더 밖/);

    expect(fs.readFileSync(outsidePath)).toEqual(source.bytes);
    expect(fs.readFileSync(source.diskPath)).toEqual(source.bytes);
  });

  it('rejects a source reported as a symbolic link without requiring symlink privileges', () => {
    const paths = makeProject();
    const source = writeSource(paths);
    const stat = fs.lstatSync(source.diskPath);
    vi.spyOn(stat, 'isSymbolicLink').mockReturnValue(true);
    const lstat = vi.spyOn(fs, 'lstatSync').mockReturnValue(stat);

    expect(() => normalizeWolfSources([makeEntry('Data/Map001.mps')], {
      'Data/Map001.mps': source.bytes,
    }, paths)).toThrow(/일반 파일이 아닙니다/);

    expect(lstat).toHaveBeenCalledWith(source.diskPath);
    expect(fs.readFileSync(source.diskPath)).toEqual(source.bytes);
  });
});
