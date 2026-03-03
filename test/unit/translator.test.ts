import { describe, it, expect } from 'vitest';
import {
  splitIntoBlocks,
  reassembleBlocks,
  validateChunk,
  contentHash,
  isPermanentApiError,
  isRetryableApiError,
} from '../../src/js/libs/geminiTranslator';
import { splitFileBlocks } from '../../src/js/rpgmv/translator';

// ─── splitIntoBlocks ────────────────────────────────────────────────

describe('splitIntoBlocks', () => {
  it('splits text with separator lines into blocks', () => {
    const content = 'line1\n--- 101 ---\nline2\nline3\n--- 101 ---\nline4';
    const blocks = splitIntoBlocks(content);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ separator: '', lines: ['line1'] });
    expect(blocks[1]).toEqual({ separator: '--- 101 ---', lines: ['line2', 'line3'] });
    expect(blocks[2]).toEqual({ separator: '--- 101 ---', lines: ['line4'] });
  });

  it('handles text with no separators as a single block', () => {
    const blocks = splitIntoBlocks('hello\nworld');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ separator: '', lines: ['hello', 'world'] });
  });

  it('handles empty input', () => {
    const blocks = splitIntoBlocks('');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ separator: '', lines: [''] });
  });

  it('handles single-line text', () => {
    const blocks = splitIntoBlocks('only one line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual(['only one line']);
  });

  it('handles text with only empty lines', () => {
    const blocks = splitIntoBlocks('\n\n\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual(['', '', '', '']);
  });

  it('handles consecutive separators', () => {
    const blocks = splitIntoBlocks('--- 101 ---\n--- 101 ---\ntext');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ separator: '--- 101 ---', lines: [] });
    expect(blocks[1]).toEqual({ separator: '--- 101 ---', lines: ['text'] });
  });

  it('preserves empty lines within blocks', () => {
    const content = 'line1\n\nline3\n--- 101 ---\n\nline5';
    const blocks = splitIntoBlocks(content);
    expect(blocks[0].lines).toEqual(['line1', '', 'line3']);
    expect(blocks[1].lines).toEqual(['', 'line5']);
  });
});

// ─── reassembleBlocks ───────────────────────────────────────────────

describe('reassembleBlocks', () => {
  it('reassembles blocks into original text', () => {
    const content = 'line1\n--- 101 ---\nline2\nline3\n--- 101 ---\nline4';
    const blocks = splitIntoBlocks(content);
    expect(reassembleBlocks(blocks)).toBe(content);
  });

  it('round-trips text without separators', () => {
    const content = 'hello\nworld';
    expect(reassembleBlocks(splitIntoBlocks(content))).toBe(content);
  });

  it('round-trips empty string', () => {
    expect(reassembleBlocks(splitIntoBlocks(''))).toBe('');
  });

  it('round-trips complex multi-block text', () => {
    const content = [
      'prologue',
      '--- 101 ---',
      'dialogue line 1',
      'dialogue line 2',
      '--- 101 ---',
      '',
      '--- 101 ---',
      'epilogue',
    ].join('\n');
    expect(reassembleBlocks(splitIntoBlocks(content))).toBe(content);
  });

  it('round-trips text with trailing newline', () => {
    const content = 'text\n--- 101 ---\nmore\n';
    expect(reassembleBlocks(splitIntoBlocks(content))).toBe(content);
  });
});

// ─── validateChunk ──────────────────────────────────────────────────

describe('validateChunk', () => {
  it('validates matching blocks', () => {
    const original = splitIntoBlocks('hello\n--- 101 ---\nworld');
    const translated = 'hola\n--- 101 ---\nmundo';
    const { validatedBlocks, blockValidations } = validateChunk(original, translated);

    expect(validatedBlocks).toHaveLength(2);
    expect(blockValidations.every(v => v.lineCountMatch)).toBe(true);
    expect(blockValidations.every(v => v.separatorMatch)).toBe(true);
  });

  it('detects line count mismatch', () => {
    const original = splitIntoBlocks('line1\nline2\n--- 101 ---\nline3');
    const translated = 'lineA\n--- 101 ---\nlineB';
    const { blockValidations } = validateChunk(original, translated);

    expect(blockValidations[0].lineCountMatch).toBe(false);
  });

  it('detects missing translated blocks', () => {
    const original = splitIntoBlocks('a\n--- 101 ---\nb\n--- 101 ---\nc');
    const translated = 'x\n--- 101 ---\ny';
    const { blockValidations } = validateChunk(original, translated);

    // Third block is missing — should fall back to original
    expect(blockValidations[2].lineCountMatch).toBe(false);
    expect(blockValidations[2].separatorMatch).toBe(false);
  });

  it('reports extra translated blocks', () => {
    const original = splitIntoBlocks('a\n--- 101 ---\nb');
    const translated = 'x\n--- 101 ---\ny\n--- 101 ---\nextra';
    const { blockValidations } = validateChunk(original, translated);

    expect(blockValidations.length).toBeGreaterThan(2);
    expect(blockValidations[2].lineCountMatch).toBe(false);
  });
});

// ─── contentHash ────────────────────────────────────────────────────

describe('contentHash', () => {
  it('returns consistent MD5 hex string', () => {
    const hash = contentHash('hello world');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(contentHash('hello world')).toBe(hash);
  });

  it('produces different hashes for different content', () => {
    expect(contentHash('abc')).not.toBe(contentHash('def'));
  });

  it('handles empty string', () => {
    const hash = contentHash('');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ─── isPermanentApiError / isRetryableApiError ──────────────────────

describe('isPermanentApiError', () => {
  it('returns true for blocked errors', () => {
    expect(isPermanentApiError(new Error('Request was blocked by safety'))).toBe(true);
  });

  it('returns true for timeout errors', () => {
    expect(isPermanentApiError(new Error('Request timeout'))).toBe(true);
  });

  it('returns true for ECONNABORTED code', () => {
    const err = new Error('abort');
    (err as any).code = 'ECONNABORTED';
    expect(isPermanentApiError(err)).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isPermanentApiError(null)).toBe(false);
    expect(isPermanentApiError(undefined)).toBe(false);
  });

  it('returns false for regular errors', () => {
    expect(isPermanentApiError(new Error('some random error'))).toBe(false);
  });
});

describe('isRetryableApiError', () => {
  it('returns true for 429 rate limit', () => {
    expect(isRetryableApiError(new Error('Error 429: Too many requests'))).toBe(true);
  });

  it('returns true for 503 errors', () => {
    expect(isRetryableApiError(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('returns true for resource_exhausted', () => {
    expect(isRetryableApiError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
  });

  it('returns true for rate limit messages', () => {
    expect(isRetryableApiError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('returns true for quota errors', () => {
    expect(isRetryableApiError(new Error('quota exceeded'))).toBe(true);
  });

  it('returns true for no candidates', () => {
    expect(isRetryableApiError(new Error('no candidates returned'))).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isRetryableApiError(null)).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isRetryableApiError(new Error('file not found'))).toBe(false);
  });
});

// ─── splitFileBlocks (translator.ts local splitter) ─────────────────

describe('splitFileBlocks', () => {
  it('splits lines by numbered separator pattern', () => {
    const lines = ['text1', '--- 42 ---', 'text2', 'text3', '--- 99 ---', 'text4'];
    const blocks = splitFileBlocks(lines);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ separator: '', lines: ['text1'] });
    expect(blocks[1]).toEqual({ separator: '--- 42 ---', lines: ['text2', 'text3'] });
    expect(blocks[2]).toEqual({ separator: '--- 99 ---', lines: ['text4'] });
  });

  it('handles empty lines array', () => {
    const blocks = splitFileBlocks([]);
    expect(blocks).toHaveLength(0);
  });

  it('handles single line with no separator', () => {
    const blocks = splitFileBlocks(['hello']);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual(['hello']);
  });

  it('handles only separator lines', () => {
    const blocks = splitFileBlocks(['--- 1 ---', '--- 2 ---']);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ separator: '--- 1 ---', lines: [] });
    expect(blocks[1]).toEqual({ separator: '--- 2 ---', lines: [] });
  });

  it('uses broader separator pattern than geminiTranslator', () => {
    // splitFileBlocks accepts any number, not just 101
    const lines = ['a', '--- 999 ---', 'b'];
    const blocks = splitFileBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].separator).toBe('--- 999 ---');
  });
});
