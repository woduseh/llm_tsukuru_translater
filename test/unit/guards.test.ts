import { describe, it, expect } from 'vitest';
import {
  isRecord,
  isString,
  isNumber,
  isBoolean,
  isAlertPayload,
  getString,
  getNumber,
  getBoolean,
} from '../../src/types/guards';

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('isString', () => {
  it('returns true for strings', () => {
    expect(isString('')).toBe(true);
    expect(isString('hello')).toBe(true);
  });

  it('returns false for non-strings', () => {
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString({})).toBe(false);
  });
});

describe('isNumber', () => {
  it('returns true for numbers', () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(-1)).toBe(true);
    expect(isNumber(3.14)).toBe(true);
  });

  it('returns false for NaN', () => {
    expect(isNumber(NaN)).toBe(false);
  });

  it('returns false for non-numbers', () => {
    expect(isNumber('42')).toBe(false);
    expect(isNumber(null)).toBe(false);
    expect(isNumber(undefined)).toBe(false);
  });
});

describe('isBoolean', () => {
  it('returns true for booleans', () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });

  it('returns false for non-booleans', () => {
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean(1)).toBe(false);
    expect(isBoolean('true')).toBe(false);
    expect(isBoolean(null)).toBe(false);
  });
});

describe('isAlertPayload', () => {
  it('returns true for valid alert payloads', () => {
    expect(isAlertPayload({ icon: 'error', message: 'test' })).toBe(true);
    expect(isAlertPayload({ icon: 'success', message: '' })).toBe(true);
  });

  it('returns false when icon is missing', () => {
    expect(isAlertPayload({ message: 'test' })).toBe(false);
  });

  it('returns false when message is missing', () => {
    expect(isAlertPayload({ icon: 'error' })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isAlertPayload('string')).toBe(false);
    expect(isAlertPayload(null)).toBe(false);
    expect(isAlertPayload(42)).toBe(false);
  });

  it('returns false when icon or message is not a string', () => {
    expect(isAlertPayload({ icon: 123, message: 'test' })).toBe(false);
    expect(isAlertPayload({ icon: 'error', message: 123 })).toBe(false);
  });
});

describe('getString', () => {
  it('returns string value for existing key', () => {
    expect(getString({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('returns fallback for non-string value', () => {
    expect(getString({ age: 25 }, 'age')).toBe('');
    expect(getString({ age: 25 }, 'age', 'N/A')).toBe('N/A');
  });

  it('returns fallback for missing key', () => {
    expect(getString({}, 'name')).toBe('');
    expect(getString({}, 'name', 'default')).toBe('default');
  });

  it('returns empty string as default fallback', () => {
    expect(getString({ x: null }, 'x')).toBe('');
  });
});

describe('getNumber', () => {
  it('returns number value for existing key', () => {
    expect(getNumber({ count: 42 }, 'count')).toBe(42);
  });

  it('returns fallback for non-number value', () => {
    expect(getNumber({ count: '42' }, 'count')).toBe(0);
    expect(getNumber({ count: '42' }, 'count', -1)).toBe(-1);
  });

  it('returns fallback for NaN', () => {
    expect(getNumber({ count: NaN }, 'count')).toBe(0);
  });

  it('returns fallback for missing key', () => {
    expect(getNumber({}, 'count')).toBe(0);
    expect(getNumber({}, 'count', 99)).toBe(99);
  });
});

describe('getBoolean', () => {
  it('returns boolean value for existing key', () => {
    expect(getBoolean({ active: true }, 'active')).toBe(true);
    expect(getBoolean({ active: false }, 'active')).toBe(false);
  });

  it('returns fallback for non-boolean value', () => {
    expect(getBoolean({ active: 1 }, 'active')).toBe(false);
    expect(getBoolean({ active: 'true' }, 'active')).toBe(false);
    expect(getBoolean({ active: 1 }, 'active', true)).toBe(true);
  });

  it('returns fallback for missing key', () => {
    expect(getBoolean({}, 'active')).toBe(false);
    expect(getBoolean({}, 'active', true)).toBe(true);
  });
});
