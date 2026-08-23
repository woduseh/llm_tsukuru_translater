import { describe, expect, it } from 'vitest';
import { migrateVersionText } from '../../src/ts/rpgmv/versionUp';

describe('version-up translation migration', () => {
  it('moves exact safe translations into the new version and keeps new lines untouched', () => {
    const oldOriginal = [
      '--- 101 ---',
      'Hello \\N[1]',
      '',
      'Potion',
      'Potion',
    ].join('\n');
    const oldTranslated = [
      '--- 101 ---',
      '안녕 \\N[1]',
      '',
      '포션',
      '포션',
    ].join('\n');
    const newOriginal = [
      '--- 101 ---',
      'New dialogue',
      'Hello \\N[1]',
      '',
      'Potion',
      'Potion',
    ].join('\n');

    const result = migrateVersionText(oldOriginal, oldTranslated, newOriginal);

    expect(result.content).toBe([
      '--- 101 ---',
      'New dialogue',
      '안녕 \\N[1]',
      '',
      '포션',
      '포션',
    ].join('\n'));
    expect(result.replacements).toBe(3);
    expect(result.dictionaryEntries).toBe(2);
    expect(result.ambiguousSourceLines).toEqual([]);
  });

  it('skips a duplicate source line when its old translations disagree', () => {
    const result = migrateVersionText(
      'Guard\nGuard\nWelcome',
      '경비병\n지킴이\n환영합니다',
      'Guard\nWelcome\nGuard',
    );

    expect(result.content).toBe('Guard\n환영합니다\nGuard');
    expect(result.replacements).toBe(1);
    expect(result.ambiguousSourceLines).toEqual(['Guard']);
  });

  it('preserves a BOM, mixed line endings, and final-newline state from the new extraction', () => {
    const result = migrateVersionText(
      'One\nTwo\n',
      '하나\n둘\n',
      '\uFEFFOne\r\nAdded\nTwo\r\n',
    );

    expect(result.content).toBe('\uFEFF하나\r\nAdded\n둘\r\n');
  });

  it('rejects structurally unsafe old translations', () => {
    expect(() => migrateVersionText(
      '--- 101 ---\nValue \\V[1]\n',
      '--- 102 ---\n값\nextra',
      '--- 101 ---\nValue \\V[1]\n',
    )).toThrow('구버전 번역본 구조가 원본과 일치하지 않습니다');
  });
});
