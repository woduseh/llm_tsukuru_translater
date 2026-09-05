import { describe, it, expect } from 'vitest';
import { checkIsMapFile } from '../../src/ts/rpgmv/globalutils';

describe('checkIsMapFile', () => {
  it.each([
    ['Map001.json', true],
    ['map001.json', false],
    ['Actors.json', false],
    ['Map.json', true],
    ['MapABC.json', false],
    ['', false],
    ['Map0.json', true],
    ['Map001.txt', true],
    ['data/Map001.json', true],
  ])('classifies the filename stem of %s as %s', (name, expected) => {
    expect(checkIsMapFile(name)).toBe(expected);
  });
});
