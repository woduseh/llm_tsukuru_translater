import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'node:perf_hooks';
import { AppContext } from '../../src/appContext';
import * as encoding from '../../src/utils';
import Tools from '../../src/ts/libs/projectTools';
import { extractEvent } from '../../src/ts/wolf/extract/ext_events';
import makeText from '../../src/ts/wolf/extract/makeText';
import WolfExtDataParser from '../../src/ts/wolf/extract/wolfExtData';
import { wolfExtractMap } from '../../src/ts/wolf/parser/Map';
import { makeWolfMap } from '../utils/wolfMapFixture';

describe('Wolf text generation', () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of roots.splice(0)) {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wolf-text-')) {
        throw new Error(`Unsafe test cleanup target: ${resolved}`);
      }
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  function fixture(strings: string[], version: 2 | 3 = 3) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-text-'));
    roots.push(root);
    const ctx = new AppContext();
    const bytes = makeWolfMap(strings, version);
    const map = wolfExtractMap(bytes, ctx);
    extractEvent(map.events[0].pages[0].cmd, 'Data/Map001.mps', {}, ctx);
    ctx.WolfCache = { 'Data/Map001.mps': bytes };
    const progress: number[] = [];
    vi.spyOn(Tools, 'send').mockImplementation((channel, value) => {
      if (channel === 'loading') progress.push(value as number);
    });
    return { ctx, extractRoot: path.join(root, '_Extract'), root, progress };
  }

  it.each([2, 3] as const)('preserves exact text and line metadata for Wolf v%i', async version => {
    const f = fixture(['最初\\c[1]\n\n最後\0', '\0', '次%1\\v[2]\n', '終端なし', ''], version);
    const groups = ['map', 'commonEvent', 'external', 'map', 'map'];
    f.ctx.WolfExtData.forEach((entry, i) => { entry.extractFile = groups[i]; });

    await makeText(f.ctx, f.extractRoot);

    const expected = {
      map: '--- 101-0 ---\n最初\\\\c[1]\n\n最後\n--- 101-0 ---\n終端なし\n--- 101-0 ---\n',
      commonEvent: '--- 101-0 ---\n',
      external: '--- 101-0 ---\n次%1\\\\v[2]\n',
    };
    for (const [name, text] of Object.entries(expected)) {
      expect(fs.readFileSync(path.join(f.extractRoot, 'Texts', `${name}.txt`))).toEqual(Buffer.from(text));
    }
    expect(f.ctx.WolfExtData.map(entry => entry.textLineNumber)).toEqual([[1, 2, 3], [1], [1, 2], [5], [7]]);
    expect(f.ctx.WolfExtData.map(entry => entry.endsWithNull)).toEqual([true, true, false, false, false]);
    const restored = new AppContext();
    WolfExtDataParser.read(path.join(f.extractRoot, '.extracteddata'), restored);
    expect(restored.WolfExtData).toEqual(f.ctx.WolfExtData);
    expect(restored.WolfCache).toEqual(f.ctx.WolfCache);
    expect(restored.WolfMetadata.ver).toBe(version);
    expect(f.progress[0]).toBe(50);
    expect(f.progress.at(-1)).toBe(0);
  });

  it('processes multiple strings per slice while allowing timers to run during a long conversion', async () => {
    const f = fixture(Array.from({ length: 60 }, (_, i) => `行${i}\0`));
    let workTime = 0;
    let processed = 0;
    const observed: number[] = [];
    const decode = encoding.decodeEncoding;
    vi.spyOn(performance, 'now').mockImplementation(() => workTime);
    vi.spyOn(encoding, 'decodeEncoding').mockImplementation((...args) => {
      workTime += 3; // Model per-entry CPU work without a timing-sensitive busy loop.
      processed++;
      return decode(...args);
    });
    const heartbeat = setInterval(() => observed.push(processed), 0);
    try { await makeText(f.ctx, f.extractRoot); } finally { clearInterval(heartbeat); }

    expect(processed).toBe(60);
    expect(observed.some(count => count > 0 && count < 60)).toBe(true);
    const progress = f.progress.slice(0, -1);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.length).toBeLessThan(30);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    const processedAtYield = progress.map(value => ((value - 50) / 50) * 60);
    const sliceSizes = [...processedAtYield.slice(1), 60].map((value, i) => value - processedAtYield[i]);
    expect(Math.max(...sliceSizes) * 3).toBeLessThanOrEqual(24);
    expect(f.progress.at(-1)).toBe(0);
    expect(fs.readFileSync(path.join(f.extractRoot, 'Texts', 'map.txt'), 'utf8').split('--- 101-0 ---')).toHaveLength(61);
  });

  it('preserves the previous extraction when decoding fails', async () => {
    const f = fixture(['One', 'Two']);
    fs.mkdirSync(f.extractRoot);
    fs.writeFileSync(path.join(f.extractRoot, 'previous.txt'), 'user translation');
    vi.spyOn(encoding, 'decodeEncoding').mockImplementation(() => { throw new Error('decode failure'); });

    await expect(makeText(f.ctx, f.extractRoot)).rejects.toThrow('decode failure');
    expect(fs.readFileSync(path.join(f.extractRoot, 'previous.txt'), 'utf8')).toBe('user translation');
    expect(fs.readdirSync(f.root)).toEqual(['_Extract']);
  });

  it('writes valid empty metadata and resets progress for an empty map', async () => {
    const f = fixture([]);
    await makeText(f.ctx, f.extractRoot);
    const restored = new AppContext();
    WolfExtDataParser.read(path.join(f.extractRoot, '.extracteddata'), restored);
    expect(restored.WolfExtData).toEqual([]);
    expect(fs.readdirSync(path.join(f.extractRoot, 'Texts'))).toEqual([]);
    expect(f.progress).toEqual([0]);
  });
});
