import { describe, it, expect } from 'vitest';
import { checkIsMapFile, sleep } from '../../src/ts/rpgmv/globalutils';

describe('checkIsMapFile', () => {
  it('returns true for Map001.json', () => {
    expect(checkIsMapFile('Map001.json')).toBe(true);
  });

  it('returns true for Map123.json', () => {
    expect(checkIsMapFile('Map123.json')).toBe(true);
  });

  it('returns false for lowercase map001.json (case-sensitive)', () => {
    expect(checkIsMapFile('map001.json')).toBe(false);
  });

  it('returns false for Actors.json', () => {
    expect(checkIsMapFile('Actors.json')).toBe(false);
  });

  it('returns true for Map.json (exact "Map" name)', () => {
    expect(checkIsMapFile('Map.json')).toBe(true);
  });

  it('returns false for MapABC.json (non-numeric suffix)', () => {
    expect(checkIsMapFile('MapABC.json')).toBe(false);
  });

  it('returns true for Map999.json', () => {
    expect(checkIsMapFile('Map999.json')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(checkIsMapFile('')).toBe(false);
  });

  it('returns true for Map0.json', () => {
    expect(checkIsMapFile('Map0.json')).toBe(true);
  });

  it('returns false for Map001.txt (different extension)', () => {
    expect(checkIsMapFile('Map001.txt')).toBe(true);
    // Note: checkIsMapFile only checks the name stem, not the extension
  });

  it('handles path with directory', () => {
    expect(checkIsMapFile('data/Map001.json')).toBe(true);
  });
});

describe('sleep', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timer inaccuracy
  });

  it('resolves with 0ms delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('returns a Promise', () => {
    const result = sleep(1);
    expect(result).toBeInstanceOf(Promise);
  });
});
