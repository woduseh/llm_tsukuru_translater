import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppContext } from '../../src/appContext';
import { decodeEncoding, encodeEncoding } from '../../src/utils';
import { wolfAppyier } from '../../src/ts/wolf/apply/applyWolf';
import {
  decryptInitialWolfArchives,
  decryptWolfArchives,
  wolfArchiveBackupPath,
} from '../../src/ts/wolf/extract/decryptSequence';
import { extractWolfFolder } from '../../src/ts/wolf/extract/extractor';
import { replaceDirectoryFromStaging } from '../../src/ts/wolf/extract/makeText';
import WolfExtDataParser from '../../src/ts/wolf/extract/wolfExtData';
import {
  findFilesWithinRoot,
  findWolfArchivesForInitialDecrypt,
  resolveWolfProjectPaths,
  toWolfProjectRelativePath,
  type WolfProjectPaths,
} from '../../src/ts/wolf/paths';
import type { extData, wolfMetadata } from '../../src/ts/wolf/types';

describe('Wolf workflow safety', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wolf-workflow-')) {
        throw new Error(`unsafe Wolf test cleanup target: ${resolved}`);
      }
      if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-workflow-'));
    temporaryRoots.push(root);
    return root;
  }

  it('resolves both project-root and Data-folder selections to one canonical extraction root', () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, 'Data');
    fs.mkdirSync(dataDir);

    expect(resolveWolfProjectPaths(projectRoot)).toEqual({
      projectRoot,
      dataDir,
      extractRoot: path.join(projectRoot, '_Extract'),
    });
    expect(resolveWolfProjectPaths(dataDir)).toEqual({
      projectRoot,
      dataDir,
      extractRoot: path.join(projectRoot, '_Extract'),
    });
  });

  it('allows an encrypted root before decryption and keeps archive discovery inside that root', () => {
    const projectRoot = makeRoot();
    const siblingRoot = makeRoot();
    fs.writeFileSync(path.join(projectRoot, 'Data.wolf'), 'archive');
    fs.mkdirSync(path.join(projectRoot, 'nested'));
    fs.writeFileSync(path.join(projectRoot, 'nested', 'MapData.WOLF'), 'archive');
    fs.writeFileSync(path.join(siblingRoot, 'Other.wolf'), 'outside');

    const paths = resolveWolfProjectPaths(projectRoot, { allowEncryptedProject: true });
    expect(paths.projectRoot).toBe(projectRoot);
    expect(paths.dataDir).toBe(path.join(projectRoot, 'Data'));
    expect(findFilesWithinRoot(projectRoot, '.wolf')).toEqual([
      path.join(projectRoot, 'Data.wolf'),
      path.join(projectRoot, 'nested', 'MapData.WOLF'),
    ]);
    expect(findWolfArchivesForInitialDecrypt(paths)).toHaveLength(2);

    fs.mkdirSync(paths.dataDir);
    expect(findWolfArchivesForInitialDecrypt(paths)).toEqual([]);
  });

  it('never deletes archives and stops the decrypt sequence at the first failure', async () => {
    const projectRoot = makeRoot();
    const archives = ['Data.wolf', 'MapData.wolf', 'BasicData.wolf'].map((name) => {
      const file = path.join(projectRoot, name);
      fs.writeFileSync(file, name);
      return file;
    });
    const calls: string[] = [];

    await expect(decryptWolfArchives(archives, async (file) => {
      calls.push(file);
      if (file === archives[1]) throw new Error('simulated decrypt failure');
    })).rejects.toThrow('simulated decrypt failure');

    expect(calls).toEqual(archives.slice(0, 2));
    for (const archive of archives) expect(fs.existsSync(archive)).toBe(true);
  });

  it('rolls back only a Data directory created by a failed initial decrypt', async () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, 'Data');
    const archives = ['Data.wolf', 'Graphic.wolf'].map((name) => {
      const file = path.join(projectRoot, name);
      fs.writeFileSync(file, name);
      return file;
    });

    await expect(decryptInitialWolfArchives(archives, { projectRoot, dataDir }, async (file) => {
      if (file === archives[0]) {
        fs.mkdirSync(dataDir);
        fs.writeFileSync(path.join(dataDir, 'partial.mps'), 'partial');
        return;
      }
      throw new Error('simulated later archive failure');
    })).rejects.toThrow('simulated later archive failure');

    expect(fs.existsSync(dataDir)).toBe(false);
    expect(findWolfArchivesForInitialDecrypt({ projectRoot, dataDir, extractRoot: path.join(projectRoot, '_Extract') })).toEqual(archives);
    for (const archive of archives) expect(fs.existsSync(archive)).toBe(true);

    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'user.mps'), 'user data');
    const decryptor = vi.fn(async () => undefined);
    await expect(decryptInitialWolfArchives(archives, { projectRoot, dataDir }, decryptor)).rejects.toThrow(/기존 Wolf Data/);
    expect(decryptor).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(dataDir, 'user.mps'), 'utf8')).toBe('user data');
  });

  it('moves successfully decrypted archives to recoverable non-.wolf names', async () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, 'Data');
    const archives = ['Data.wolf', 'MapData.wolf'].map((name) => {
      const file = path.join(projectRoot, name);
      fs.writeFileSync(file, name);
      return file;
    });

    await decryptInitialWolfArchives(archives, { projectRoot, dataDir }, async (file) => {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, `${path.basename(file)}.dat`), 'decrypted');
    });

    for (const archive of archives) {
      expect(fs.existsSync(archive)).toBe(false);
      expect(fs.readFileSync(wolfArchiveBackupPath(archive), 'utf8')).toBe(path.basename(archive));
      expect(path.extname(wolfArchiveBackupPath(archive)).toLowerCase()).not.toBe('.wolf');
    }
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  it('restores moved archives and removes generated Data when archive deactivation fails', async () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, 'Data');
    const archives = ['Data.wolf', 'MapData.wolf'].map((name) => {
      const file = path.join(projectRoot, name);
      fs.writeFileSync(file, name);
      return file;
    });
    const originalRename = fs.renameSync.bind(fs);
    let injected = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (!injected && path.resolve(String(oldPath)) === path.resolve(archives[1])) {
        injected = true;
        throw new Error('simulated archive move failure');
      }
      return originalRename(oldPath, newPath);
    });

    await expect(decryptInitialWolfArchives(archives, { projectRoot, dataDir }, async () => {
      fs.mkdirSync(dataDir, { recursive: true });
    })).rejects.toThrow('simulated archive move failure');

    expect(injected).toBe(true);
    expect(fs.existsSync(dataDir)).toBe(false);
    for (const archive of archives) {
      expect(fs.existsSync(archive)).toBe(true);
      expect(fs.existsSync(wolfArchiveBackupPath(archive))).toBe(false);
    }
  });

  it('rejects an archive backup collision before running wolfdec', async () => {
    const projectRoot = makeRoot();
    const dataDir = path.join(projectRoot, 'Data');
    const archive = path.join(projectRoot, 'Data.wolf');
    fs.writeFileSync(archive, 'archive');
    fs.writeFileSync(wolfArchiveBackupPath(archive), 'existing backup');
    const decryptor = vi.fn(async () => undefined);

    await expect(decryptInitialWolfArchives([archive], { projectRoot, dataDir }, decryptor))
      .rejects.toThrow(/백업 경로/);
    expect(decryptor).not.toHaveBeenCalled();
    expect(fs.readFileSync(archive, 'utf8')).toBe('archive');
    expect(fs.readFileSync(wolfArchiveBackupPath(archive), 'utf8')).toBe('existing backup');
  });

  it('preserves the previous _Extract directory when staging fails', () => {
    const projectRoot = makeRoot();
    const extractRoot = path.join(projectRoot, '_Extract');
    fs.mkdirSync(extractRoot);
    fs.writeFileSync(path.join(extractRoot, 'old.txt'), 'old');

    expect(() => replaceDirectoryFromStaging(extractRoot, (stagingDir) => {
      fs.writeFileSync(path.join(stagingDir, 'new.txt'), 'new');
      throw new Error('simulated writer failure');
    })).toThrow('simulated writer failure');

    expect(fs.readFileSync(path.join(extractRoot, 'old.txt'), 'utf8')).toBe('old');
    expect(fs.existsSync(path.join(extractRoot, 'new.txt'))).toBe(false);
    expect(fs.readdirSync(projectRoot).some((name) => name.startsWith('._Extract.staging-'))).toBe(false);
  });

  it('propagates map parser failures without replacing the previous _Extract directory', async () => {
    const projectRoot = makeRoot();
    const paths = createProjectDirectories(projectRoot);
    fs.writeFileSync(path.join(paths.dataDir, 'Broken.mps'), Buffer.from('not-a-wolf-map'));
    fs.writeFileSync(path.join(paths.extractRoot, 'old.txt'), 'old');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(extractWolfFolder(paths.dataDir, {}, new AppContext(), paths.projectRoot)).rejects.toThrow();

    expect(fs.readFileSync(path.join(paths.extractRoot, 'old.txt'), 'utf8')).toBe('old');
  });

  it('encodes Wolf v2 text symmetrically and rejects unrepresentable characters', () => {
    const metadata: wolfMetadata = { ver: 2 };
    const text = 'こんにちは\\c[1]\0';
    const encoded = encodeEncoding(text, metadata);

    expect(decodeEncoding(encoded, metadata)).toBe(text);
    expect(() => encodeEncoding('한국어 번역', metadata)).toThrow(/Shift_JIS로 표현할 수 없는 문자/);
  });

  it('applies a project-relative v3 source with a full preflight and atomic replacement', async () => {
    const fixture = makeSingleApplyFixture({
      original: 'Hello \\V[1]\n\nEnd\0',
      translated: '안녕 \\\\V[1]\n\n끝',
      ver: 3,
    });

    await wolfAppyier(new AppContext(), fixture.paths);

    const output = fs.readFileSync(fixture.diskPath);
    const length = output.readUInt32LE(0);
    expect(output.subarray(4, 4 + length).toString('utf8')).toBe('안녕 \\V[1]\n\n끝\0');
    expect(fs.readdirSync(path.dirname(fixture.diskPath)).some((name) => name.includes('.wolf-apply-'))).toBe(false);
  });

  it('accepts legacy absolute metadata only when it resolves inside the selected Data root', async () => {
    const inside = makeSingleApplyFixture({ original: 'Hello', translated: 'Translated', sourceStyle: 'absolute-inside' });
    fs.renameSync(inside.paths.extractRoot, path.join(inside.paths.dataDir, '_Extract'));
    await wolfAppyier(new AppContext(), inside.paths);
    expect(readBinaryText(inside.diskPath, { ver: 3 })).toBe('Translated');

    const outside = makeSingleApplyFixture({ original: 'Outside', translated: 'Changed', sourceStyle: 'absolute-outside' });
    const before = fs.readFileSync(outside.diskPath);
    await expect(wolfAppyier(new AppContext(), outside.paths)).rejects.toThrow(/Data 폴더 밖/);
    expect(fs.readFileSync(outside.diskPath)).toEqual(before);
  });

  it('fails closed when current disk bytes differ from the extraction cache', async () => {
    const fixture = makeSingleApplyFixture({ original: 'Original', translated: 'Translated' });
    const changed = makeLengthPrefixed(Buffer.from('Changed!', 'utf8'));
    fs.writeFileSync(fixture.diskPath, changed);

    await expect(wolfAppyier(new AppContext(), fixture.paths)).rejects.toThrow(/추출 이후 변경/);
    expect(fs.readFileSync(fixture.diskPath)).toEqual(changed);
  });

  it('does not write any source when a later source fails preflight', async () => {
    const projectRoot = makeRoot();
    const paths = createProjectDirectories(projectRoot);
    const firstPath = path.join(paths.dataDir, 'Map001.mps');
    const secondPath = path.join(paths.dataDir, 'Map002.mps');
    const firstOriginal = makeLengthPrefixed(Buffer.from('One', 'utf8'));
    const secondOriginal = makeLengthPrefixed(Buffer.from('Two', 'utf8'));
    fs.writeFileSync(firstPath, firstOriginal);
    fs.writeFileSync(secondPath, secondOriginal);

    const ctx = new AppContext();
    ctx.WolfMetadata = { ver: 3 };
    ctx.WolfCache = {
      'Data/Map001.mps': firstOriginal,
      'Data/Map002.mps': secondOriginal,
    };
    ctx.WolfExtData = [
      makeExtEntry('Data/Map001.mps', Buffer.from('One'), 1, '101-0'),
      makeExtEntry('Data/Map002.mps', Buffer.from('Two'), 3, '102-0'),
    ];
    writeExtraction(paths, ctx, {
      map: ['--- 101-0 ---', '하나', '--- 102-0 ---', '둘'].join('\n'),
    });
    const staleSecond = makeLengthPrefixed(Buffer.from('Stale', 'utf8'));
    fs.writeFileSync(secondPath, staleSecond);

    await expect(wolfAppyier(new AppContext(), paths)).rejects.toThrow(/추출 이후 변경/);
    expect(fs.readFileSync(firstPath)).toEqual(firstOriginal);
    expect(fs.readFileSync(secondPath)).toEqual(staleSecond);
  });

  it('restores every original when a later multi-file apply rename fails', async () => {
    const fixture = makeTwoSourceApplyFixture();
    const originalRenameSync = fs.renameSync.bind(fs);
    let injected = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (
        !injected
        && String(oldPath).endsWith('.staged')
        && path.resolve(String(newPath)) === path.resolve(fixture.secondPath)
      ) {
        injected = true;
        throw new Error('simulated second commit rename failure');
      }
      return originalRenameSync(oldPath, newPath);
    });

    await expect(wolfAppyier(new AppContext(), fixture.paths)).rejects.toThrow(/모든 원본을 복구/);

    expect(injected).toBe(true);
    expect(fs.readFileSync(fixture.firstPath)).toEqual(fixture.firstOriginal);
    expect(fs.readFileSync(fixture.secondPath)).toEqual(fixture.secondOriginal);
    expect(fs.readdirSync(fixture.paths.dataDir).filter((name) => name.includes('.wolf-apply-'))).toEqual([]);
  });

  it('leaves every original untouched when a later apply staging write fails', async () => {
    const fixture = makeTwoSourceApplyFixture();
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    let stagedWrites = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (typeof file === 'number') {
        stagedWrites += 1;
        if (stagedWrites === 2) throw new Error('simulated second staging write failure');
      }
      return originalWriteFileSync(file, data, options);
    });

    await expect(wolfAppyier(new AppContext(), fixture.paths)).rejects.toThrow(/staging 파일/);

    expect(stagedWrites).toBe(2);
    expect(fs.readFileSync(fixture.firstPath)).toEqual(fixture.firstOriginal);
    expect(fs.readFileSync(fixture.secondPath)).toEqual(fixture.secondOriginal);
    expect(fs.readdirSync(fixture.paths.dataDir).filter((name) => name.includes('.wolf-apply-'))).toEqual([]);
  });

  it('rejects changed separators, empty lines, control codes, and v2-only encoding loss before writing', async () => {
    const separator = makeSingleApplyFixture({ original: 'Hello', translated: '안녕' });
    fs.writeFileSync(path.join(separator.paths.extractRoot, 'Texts', 'map.txt'), '--- 999-0 ---\n안녕');
    const separatorBefore = fs.readFileSync(separator.diskPath);
    await expect(wolfAppyier(new AppContext(), separator.paths)).rejects.toThrow(/구분자/);
    expect(fs.readFileSync(separator.diskPath)).toEqual(separatorBefore);

    const control = makeSingleApplyFixture({ original: 'Hello \\V[1]', translated: '안녕' });
    const controlBefore = fs.readFileSync(control.diskPath);
    await expect(wolfAppyier(new AppContext(), control.paths)).rejects.toThrow(/제어 코드/);
    expect(fs.readFileSync(control.diskPath)).toEqual(controlBefore);

    const emptyLine = makeSingleApplyFixture({ original: 'First\n\nThird', translated: '첫째\n빈 줄을 채움\n셋째' });
    const emptyLineBefore = fs.readFileSync(emptyLine.diskPath);
    await expect(wolfAppyier(new AppContext(), emptyLine.paths)).rejects.toThrow(/빈 줄/);
    expect(fs.readFileSync(emptyLine.diskPath)).toEqual(emptyLineBefore);

    const v2 = makeSingleApplyFixture({ original: 'こんにちは', translated: '한국어', ver: 2 });
    const v2Before = fs.readFileSync(v2.diskPath);
    await expect(wolfAppyier(new AppContext(), v2.paths)).rejects.toThrow(/Shift_JIS/);
    expect(fs.readFileSync(v2.diskPath)).toEqual(v2Before);
  });

  function makeSingleApplyFixture(options: {
    original: string;
    translated: string;
    ver?: 2 | 3;
    sourceStyle?: 'project-relative' | 'absolute-inside' | 'absolute-outside';
  }): { paths: WolfProjectPaths; diskPath: string } {
    const projectRoot = makeRoot();
    const paths = createProjectDirectories(projectRoot);
    const ver = options.ver ?? 3;
    const sourceStyle = options.sourceStyle ?? 'project-relative';
    const diskPath = sourceStyle === 'absolute-outside'
      ? path.join(projectRoot, 'Outside.mps')
      : path.join(paths.dataDir, 'Map001.mps');
    const originalBytes = encodeEncoding(options.original, { ver });
    const source = makeLengthPrefixed(originalBytes);
    fs.writeFileSync(diskPath, source);
    const sourceFile = sourceStyle === 'project-relative'
      ? toWolfProjectRelativePath(paths.projectRoot, diskPath)
      : diskPath;

    const ctx = new AppContext();
    ctx.WolfMetadata = { ver };
    ctx.WolfCache = { [sourceFile]: source };
    const endsWithNull = options.original.endsWith('\0');
    const originalText = endsWithNull ? options.original.slice(0, -1) : options.original;
    ctx.WolfExtData = [makeExtEntry(
      sourceFile,
      originalBytes,
      1,
      '101-0',
      originalText.split('\n').length,
      endsWithNull,
    )];
    writeExtraction(paths, ctx, {
      map: `--- 101-0 ---\n${options.translated}`,
    });
    return { paths, diskPath };
  }

  function makeTwoSourceApplyFixture(): {
    paths: WolfProjectPaths;
    firstPath: string;
    secondPath: string;
    firstOriginal: Buffer;
    secondOriginal: Buffer;
  } {
    const projectRoot = makeRoot();
    const paths = createProjectDirectories(projectRoot);
    const firstPath = path.join(paths.dataDir, 'Map001.mps');
    const secondPath = path.join(paths.dataDir, 'Map002.mps');
    const firstOriginal = makeLengthPrefixed(Buffer.from('One', 'utf8'));
    const secondOriginal = makeLengthPrefixed(Buffer.from('Two', 'utf8'));
    fs.writeFileSync(firstPath, firstOriginal);
    fs.writeFileSync(secondPath, secondOriginal);

    const ctx = new AppContext();
    ctx.WolfMetadata = { ver: 3 };
    ctx.WolfCache = {
      'Data/Map001.mps': firstOriginal,
      'Data/Map002.mps': secondOriginal,
    };
    ctx.WolfExtData = [
      makeExtEntry('Data/Map001.mps', Buffer.from('One'), 1, '101-0'),
      makeExtEntry('Data/Map002.mps', Buffer.from('Two'), 3, '102-0'),
    ];
    writeExtraction(paths, ctx, {
      map: ['--- 101-0 ---', '하나', '--- 102-0 ---', '둘'].join('\n'),
    });

    return { paths, firstPath, secondPath, firstOriginal, secondOriginal };
  }
});

function createProjectDirectories(projectRoot: string): WolfProjectPaths {
  const dataDir = path.join(projectRoot, 'Data');
  const extractRoot = path.join(projectRoot, '_Extract');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(extractRoot, 'Texts'), { recursive: true });
  return { projectRoot, dataDir, extractRoot };
}

function makeLengthPrefixed(text: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(text.length, 0);
  return Buffer.concat([header, text]);
}

function makeExtEntry(
  sourceFile: string,
  bytes: Buffer,
  textLine: number,
  codeStr: string,
  lineCount = 1,
  endsWithNull = false,
): extData {
  return {
    str: { pos1: 0, pos2: 4, pos3: 4 + bytes.length, str: bytes, len: bytes.length },
    sourceFile,
    extractFile: 'map',
    endsWithNull,
    textLineNumber: Array.from({ length: lineCount }, (_, index) => textLine + index),
    codeStr,
  };
}

function writeExtraction(paths: WolfProjectPaths, ctx: AppContext, texts: Record<string, string>): void {
  for (const [name, text] of Object.entries(texts)) {
    fs.writeFileSync(path.join(paths.extractRoot, 'Texts', `${name}.txt`), text, 'utf8');
  }
  WolfExtDataParser.create(path.join(paths.extractRoot, '.extracteddata'), ctx);
}

function readBinaryText(filePath: string, metadata: wolfMetadata): string {
  const data = fs.readFileSync(filePath);
  const length = data.readUInt32LE(0);
  return decodeEncoding(data.subarray(4, 4 + length), metadata);
}
