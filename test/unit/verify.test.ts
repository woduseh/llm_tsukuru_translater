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
    const result = repairJson(orig, trans);
    expect(result.code).toBe(401);
    expect(result.indent).toBe(0);
    // code 401 params are translatable so translated value is kept
    expect(result.parameters[0]).toBe('Translated');
  });

  it('returns null for null inputs', () => {
    expect(repairJson(null, null)).toBe(null);
  });
});
