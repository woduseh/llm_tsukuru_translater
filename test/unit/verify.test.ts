import { describe, it, expect } from 'vitest';
import { verifyJsonIntegrity, repairJson } from '../../src/js/rpgmv/verify';

describe('verifyJsonIntegrity', () => {
  it('returns no issues for identical objects', () => {
    const obj = { id: 1, name: 'Harold', nickname: '' };
    const issues = verifyJsonIntegrity(obj, obj);
    expect(issues).toEqual([]);
  });

  it('detects type mismatch', () => {
    const issues = verifyJsonIntegrity('hello', 42);
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('type_mismatch');
    expect(issues[0].severity).toBe('error');
  });

  it('detects array length mismatch', () => {
    const issues = verifyJsonIntegrity([1, 2, 3], [1, 2]);
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('array_length');
  });

  it('detects value change for numbers', () => {
    const orig = { id: 1, code: 401 };
    const trans = { id: 1, code: 402 };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'value_changed')).toBe(true);
  });

  it('detects string change in deny policy (default)', () => {
    const issues = verifyJsonIntegrity('original', 'translated');
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('string_changed');
    expect(issues[0].severity).toBe('error');
  });

  it('allows string change in allow policy', () => {
    const issues = verifyJsonIntegrity('original', 'translated', '$', undefined, 'allow');
    expect(issues.filter(i => i.type === 'string_changed')).toEqual([]);
  });

  it('detects keys removed', () => {
    const orig = { a: 1, b: 2, c: 3 };
    const trans = { a: 1 };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'keys_removed')).toBe(true);
  });

  it('detects keys added', () => {
    const orig = { a: 1 };
    const trans = { a: 1, b: 2 };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'keys_added')).toBe(true);
  });

  it('handles null values without issues', () => {
    const issues = verifyJsonIntegrity(null, null);
    expect(issues).toEqual([]);
  });

  it('verifies event command code mismatch', () => {
    const orig = { code: 401, indent: 0, parameters: ['Hello'] };
    const trans = { code: 402, indent: 0, parameters: ['Hello'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'value_changed' && i.path.includes('code'))).toBe(true);
  });

  it('allows translated text in event code 401 parameters', () => {
    const orig = { code: 401, indent: 0, parameters: ['Hello World'] };
    const trans = { code: 401, indent: 0, parameters: ['こんにちは世界'] };
    const issues = verifyJsonIntegrity(orig, trans);
    // code 401 params are translatable, so no string_changed errors
    expect(issues.filter(i => i.type === 'string_changed')).toEqual([]);
  });

  it('detects text shift on code 102 (choice text)', () => {
    const orig = { code: 102, indent: 0, parameters: [['はい', '--- 5 ---', 'いいえ']] };
    const trans = { code: 102, indent: 0, parameters: [['예', '밀려온 텍스트', '아니오']] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'text_shift')).toBe(true);
  });

  it('detects text shift on code 101 param[4] (name tag)', () => {
    const orig = { code: 101, indent: 0, parameters: ['face.png', 0, 0, 2, '【月茜】'] };
    const trans = { code: 101, indent: 0, parameters: ['face.png', 0, 0, 2, '밀려온 대사'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'text_shift')).toBe(true);
  });

  it('detects text shift on code 402 param[1] (branch text)', () => {
    const orig = { code: 402, indent: 0, parameters: [0, ''] };
    const trans = { code: 402, indent: 0, parameters: [0, '밀려온 텍스트'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'text_shift')).toBe(true);
  });

  it('detects placeholder ----- (dashes without number)', () => {
    const orig = { code: 401, indent: 0, parameters: ['-----'] };
    const trans = { code: 401, indent: 0, parameters: ['밀려온 대사'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'text_shift')).toBe(true);
  });

  it('detects half-width bracket name tag [名前]', () => {
    const orig = { code: 401, indent: 0, parameters: ['[名前]'] };
    const trans = { code: 401, indent: 0, parameters: ['밀려온 대사'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'text_shift')).toBe(true);
  });

  it('allows translated half-width bracket name tag', () => {
    const orig = { code: 401, indent: 0, parameters: ['[名前]'] };
    const trans = { code: 401, indent: 0, parameters: ['[이름]'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.filter(i => i.type === 'text_shift')).toEqual([]);
  });

  it('detects boolean value change', () => {
    const issues = verifyJsonIntegrity(true, false);
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('value_changed');
  });

  it('handles undefined vs null type mismatch', () => {
    const issues = verifyJsonIntegrity(undefined, null);
    // Both map to 'null' type via getType
    expect(issues).toEqual([]);
  });

  it('detects control character mismatch in allow policy', () => {
    const issues = verifyJsonIntegrity(
      'Test \\V[1] message',
      'Test message',  // missing \\V[1]
      '$', undefined, 'allow'
    );
    expect(issues.some(i => i.type === 'control_char_mismatch')).toBe(true);
  });

  it('verifies event command indent mismatch', () => {
    const orig = { code: 401, indent: 0, parameters: ['Hello'] };
    const trans = { code: 401, indent: 2, parameters: ['Hello'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'value_changed' && i.path.includes('indent'))).toBe(true);
  });

  it('verifies event command parameter array length mismatch', () => {
    const orig = { code: 401, indent: 0, parameters: ['Hello', 'World'] };
    const trans = { code: 401, indent: 0, parameters: ['안녕'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'array_length')).toBe(true);
  });

  it('detects symbol-only line text shift', () => {
    const orig = { code: 401, indent: 0, parameters: ['........'] };
    const trans = { code: 401, indent: 0, parameters: ['실제 대사가 밀려옴'] };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.some(i => i.type === 'text_shift')).toBe(true);
  });

  it('allows translatable field displayName to change', () => {
    const orig = { displayName: '東の洞窟', autoplayBgm: true };
    const trans = { displayName: '동쪽 동굴', autoplayBgm: true };
    const issues = verifyJsonIntegrity(orig, trans);
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });
});

describe('repairJson', () => {
  it('preserves original for non-string types', () => {
    expect(repairJson(42, 99)).toBe(42);
    expect(repairJson(true, false)).toBe(true);
  });

  it('keeps original string in deny policy', () => {
    expect(repairJson('original', 'translated', 'deny')).toBe('original');
  });

  it('uses translated string in allow policy', () => {
    expect(repairJson('original', 'translated', 'allow')).toBe('translated');
  });

  it('falls back to original on type mismatch', () => {
    const result = repairJson({ a: 1 }, 'string');
    expect(result).toEqual({ a: 1 });
  });

  it('repairs arrays to original length', () => {
    const orig = [1, 2, 3];
    const trans = [1, 2];
    const result = repairJson(orig, trans);
    expect(result).toEqual([1, 2, 3]);
  });

  it('repairs event command by preserving code and indent', () => {
    const orig = { code: 401, indent: 0, parameters: ['Hello'] };
    const trans = { code: 999, indent: 5, parameters: ['Translated'] };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.code).toBe(401);
    expect(result.indent).toBe(0);
    // code 401 params are translatable so translated value is kept
    expect(result.parameters[0]).toBe('Translated');
  });

  it('returns null for null inputs', () => {
    expect(repairJson(null, null)).toBe(null);
  });

  it('reverts empty string that got filled (text shift repair)', () => {
    const orig = { code: 401, indent: 0, parameters: [''] };
    const trans = { code: 401, indent: 0, parameters: ['밀려온 대사'] };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.parameters[0]).toBe('');
  });

  it('reverts placeholder marker that got overwritten (text shift repair)', () => {
    const orig = { code: 401, indent: 0, parameters: ['--- 101 ---'] };
    const trans = { code: 401, indent: 0, parameters: ['번역된 대사가 밀려옴'] };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.parameters[0]).toBe('--- 101 ---');
  });

  it('reverts name bracket that got overwritten (text shift repair)', () => {
    const orig = { code: 401, indent: 0, parameters: ['【月茜】'] };
    const trans = { code: 401, indent: 0, parameters: ['밀려온 대사'] };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.parameters[0]).toBe('【月茜】');
  });

  it('keeps translated name bracket if brackets preserved', () => {
    const orig = { code: 401, indent: 0, parameters: ['【月茜】'] };
    const trans = { code: 401, indent: 0, parameters: ['【유에시】'] };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.parameters[0]).toBe('【유에시】');
  });

  it('reverts symbol-only line that got filled with text (text shift repair)', () => {
    const orig = { code: 401, indent: 0, parameters: ['........'] };
    const trans = { code: 401, indent: 0, parameters: ['실제 대사가 밀려옴'] };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.parameters[0]).toBe('........');
  });

  it('repairs comment_ keys with text shift', () => {
    const orig = { id: 1, comment_0: '--- 5 ---', comment_1: '대화 내용' };
    const trans = { id: 1, comment_0: '밀려온 텍스트', comment_1: '번역된 대화' };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.comment_0).toBe('--- 5 ---');
    expect(result.comment_1).toBe('번역된 대화');
  });

  it('repairs nested object preserving original keys when trans has missing keys', () => {
    const orig = { a: 1, b: { c: 2, d: 3 } };
    const trans = { a: 1, b: { c: 2 } };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.b.d).toBe(3);
  });

  it('handles deeply nested arrays', () => {
    const orig = [[1, 2], [3, 4]];
    const trans = [[1], [3, 4]];
    const result = repairJson(orig, trans) as number[][];
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('preserves translated displayName field', () => {
    const orig = { id: 1, displayName: '東の洞窟' };
    const trans = { id: 1, displayName: '동쪽 동굴' };
    const result = repairJson(orig, trans) as Record<string, any>;
    expect(result.displayName).toBe('동쪽 동굴');
  });

  it('preserves original boolean value even when trans changes it', () => {
    expect(repairJson(true, false)).toBe(true);
    expect(repairJson(false, true)).toBe(false);
  });
});

import { getAtPath, setAtPath } from '../../src/js/rpgmv/verify';

describe('getAtPath / setAtPath', () => {

  it('navigates dot paths', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getAtPath(obj, '$.a.b.c')).toBe(42);
  });

  it('navigates array indices', () => {
    const obj = { items: [10, 20, 30] };
    expect(getAtPath(obj, '$.items[1]')).toBe(20);
  });

  it('navigates mixed paths', () => {
    const obj = { events: [null, { pages: [{ list: [{ code: 401 }] }] }] };
    expect(getAtPath(obj, '$.events[1].pages[0].list[0].code')).toBe(401);
  });

  it('returns undefined for missing paths', () => {
    expect(getAtPath({ a: 1 }, '$.b.c')).toBeUndefined();
  });

  it('handles root path $', () => {
    const obj = { a: 1 };
    expect(getAtPath(obj, '$')).toEqual({ a: 1 });
  });

  it('handles empty path after $', () => {
    const obj = { a: 1 };
    expect(getAtPath(obj, '$.')).toEqual({ a: 1 });
  });

  it('returns undefined when navigating through null', () => {
    expect(getAtPath({ a: null }, '$.a.b')).toBeUndefined();
  });

  it('returns undefined when navigating through primitive', () => {
    expect(getAtPath({ a: 42 }, '$.a.b')).toBeUndefined();
  });

  it('sets value at dot path', () => {
    const obj = { a: { b: 'old' } };
    expect(setAtPath(obj, '$.a.b', 'new')).toBe(true);
    expect(obj.a.b).toBe('new');
  });

  it('sets value at array index', () => {
    const obj = { items: [1, 2, 3] };
    expect(setAtPath(obj, '$.items[1]', 99)).toBe(true);
    expect(obj.items[1]).toBe(99);
  });

  it('returns false for invalid paths', () => {
    expect(setAtPath({ a: 1 }, '$.b.c', 'x')).toBe(false);
  });

  it('returns false for empty path', () => {
    expect(setAtPath({ a: 1 }, '$', 'x')).toBe(false);
  });

  it('returns false when intermediate is null', () => {
    expect(setAtPath({ a: null }, '$.a.b', 'x')).toBe(false);
  });

  it('returns false when intermediate is primitive', () => {
    expect(setAtPath({ a: 42 }, '$.a.b', 'x')).toBe(false);
  });
});
