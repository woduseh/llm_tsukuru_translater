import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/appContext';
import { settings } from '../../src/ts/rpgmv/datas';
import { createTranslationBackup, trans } from '../../src/ts/rpgmv/translator';
import Tools from '../../src/ts/libs/projectTools';
import * as atomic from '../../src/ts/libs/atomicFile';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture() {
  const parent = path.resolve('artifacts/unit/translationReset');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  roots.push(root);
  const extract = path.join(root, 'Extract');
  const backup = extract + '_backup';
  fs.mkdirSync(extract);
  fs.mkdirSync(backup);
  for (const name of ['A.txt', 'B.txt', 'ext_javascript.js']) {
    fs.writeFileSync(path.join(extract, name), `translated ${name}`);
    fs.writeFileSync(path.join(backup, name), `\uFEFForiginal ${name}\r\n`);
  }
  return { root, extract, backup };
}

it('rejects an incomplete backup before reset mutates translations, cache or progress', async () => {
  const { root, extract, backup } = fixture();
  fs.unlinkSync(path.join(backup, 'B.txt'));
  const progress = path.join(extract, '.llm_progress.json');
  const cache = path.join(extract, '.llm_cache.json');
  fs.writeFileSync(progress, 'old progress');
  fs.writeFileSync(cache, 'old cache');
  const send = vi.fn();
  const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('unexpected provider request'));
  const ctx = { settings: { ...settings, llmApiKey: 'fixture', llmModel: 'fixture' },
    mainWindow: { webContents: { send } } } as unknown as AppContext;
  Tools.init(ctx);

  await trans(null, { dir: Buffer.from(root).toString('base64'), resetProgress: true, translationMode: 'all' }, ctx);

  expect(send.mock.calls.some(([channel, data]) => channel === 'alert' && data.icon === 'error' && data.message.includes('불완전'))).toBe(true);
  expect(fs.readFileSync(path.join(extract, 'A.txt'), 'utf8')).toBe('translated A.txt');
  expect(fs.readFileSync(path.join(extract, 'B.txt'), 'utf8')).toBe('translated B.txt');
  expect(fs.readFileSync(path.join(backup, 'A.txt'), 'utf8')).toBe('\uFEFForiginal A.txt\r\n');
  expect(fs.existsSync(path.join(backup, 'B.txt'))).toBe(false);
  expect(fs.readFileSync(progress, 'utf8')).toBe('old progress');
  expect(fs.readFileSync(cache, 'utf8')).toBe('old cache');
  expect(post).not.toHaveBeenCalled();
});

it('restores the full translation surface and retains exact original backup bytes', async () => {
  const { extract, backup } = fixture();
  fs.writeFileSync(path.join(backup, 'notes.json'), 'keep backup metadata');
  fs.writeFileSync(path.join(extract, 'unrelated.json'), 'keep translation metadata');

  expect(await createTranslationBackup(extract, true)).toBe(backup);

  for (const name of ['A.txt', 'B.txt', 'ext_javascript.js']) {
    expect(fs.readFileSync(path.join(extract, name), 'utf8')).toBe(`\uFEFForiginal ${name}\r\n`);
    expect(fs.readFileSync(path.join(backup, name), 'utf8')).toBe(`\uFEFForiginal ${name}\r\n`);
  }
  expect(fs.readFileSync(path.join(backup, 'notes.json'), 'utf8')).toBe('keep backup metadata');
  expect(fs.readFileSync(path.join(extract, 'unrelated.json'), 'utf8')).toBe('keep translation metadata');
});

it('restores already changed translations when a later reset replacement fails', async () => {
  const { extract, backup } = fixture();
  const write = atomic.atomicWriteTextFile;
  vi.spyOn(atomic, 'atomicWriteTextFile').mockImplementation((file, content, options) => {
    if (file === path.join(extract, 'B.txt')) throw new Error('disk full');
    write(file, content, options);
  });

  await expect(createTranslationBackup(extract, true)).rejects.toThrow('disk full');

  for (const name of ['A.txt', 'B.txt', 'ext_javascript.js']) {
    expect(fs.readFileSync(path.join(extract, name), 'utf8')).toBe(`translated ${name}`);
    expect(fs.readFileSync(path.join(backup, name), 'utf8')).toBe(`\uFEFForiginal ${name}\r\n`);
  }
});
