import { describe, it, expect } from 'vitest';
import { checkIsMapFile } from '../../src/js/rpgmv/globalutils';

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
    // The implementation checks fileName === 'Map' first
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
});
