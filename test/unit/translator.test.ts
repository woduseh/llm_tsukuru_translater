import { describe, it, expect } from 'vitest';
import {
  splitIntoBlocks,
  reassembleBlocks,
  validateChunk,
  contentHash,
  isPermanentApiError,
  isRetryableApiError,
  createGeminiTranslator,
} from '../../src/ts/libs/geminiTranslator';
import { splitFileBlocks } from '../../src/ts/rpgmv/translator';

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

  it('splits on any numbered separator, not just 101', () => {
    const content = 'a\n--- 1 ---\nb\n--- 42 ---\nc\n--- 999 ---\nd';
    const blocks = splitIntoBlocks(content);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({ separator: '', lines: ['a'] });
    expect(blocks[1]).toEqual({ separator: '--- 1 ---', lines: ['b'] });
    expect(blocks[2]).toEqual({ separator: '--- 42 ---', lines: ['c'] });
    expect(blocks[3]).toEqual({ separator: '--- 999 ---', lines: ['d'] });
  });

  it('handles separators with extra whitespace around number', () => {
    const content = 'a\n---  5  ---\nb';
    const blocks = splitIntoBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].separator).toBe('---  5  ---');
  });

  it('does not split on non-numeric separator patterns', () => {
    const content = 'a\n--- abc ---\nb';
    const blocks = splitIntoBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual(['a', '--- abc ---', 'b']);
  });

  it('round-trips with mixed separator numbers', () => {
    const content = 'prologue\n--- 1 ---\nchapter 1\n--- 2 ---\nchapter 2';
    expect(reassembleBlocks(splitIntoBlocks(content))).toBe(content);
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

  it('handles empty original blocks', () => {
    const original: { separator: string; lines: string[] }[] = [];
    const translated = 'some text';
    const { validatedBlocks, blockValidations } = validateChunk(original, translated);
    expect(validatedBlocks).toHaveLength(0);
    expect(blockValidations).toHaveLength(1);
    expect(blockValidations[0].originalLines).toEqual([]);
  });

  it('handles empty translated text', () => {
    const original = splitIntoBlocks('hello\n--- 101 ---\nworld');
    const { validatedBlocks, blockValidations } = validateChunk(original, '');
    // First block gets translated empty string, second block falls back to original
    expect(validatedBlocks).toHaveLength(2);
    expect(blockValidations[1].separatorMatch).toBe(false);
  });

  it('validates separator mismatch with different numbers', () => {
    const original = splitIntoBlocks('a\n--- 1 ---\nb');
    const translated = 'x\n--- 2 ---\ny';
    const { blockValidations } = validateChunk(original, translated);
    expect(blockValidations[1].separatorMatch).toBe(false);
  });

  it('treats empty separator as always matching', () => {
    const original = [{ separator: '', lines: ['a'] }];
    const translated = 'x';
    const { blockValidations } = validateChunk(original, translated);
    expect(blockValidations[0].separatorMatch).toBe(true);
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

  it('handles plain string as error', () => {
    expect(isPermanentApiError('blocked by filter')).toBe(true);
  });

  it('handles object with message property', () => {
    expect(isPermanentApiError({ message: 'timeout occurred' })).toBe(true);
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

  it('returns true for overloaded errors', () => {
    expect(isRetryableApiError(new Error('model is overloaded'))).toBe(true);
  });

  it('returns true for unavailable errors', () => {
    expect(isRetryableApiError(new Error('service unavailable'))).toBe(true);
  });

  it('returns true for deadline exceeded', () => {
    expect(isRetryableApiError(new Error('deadline exceeded'))).toBe(true);
  });

  it('returns true for internal errors', () => {
    expect(isRetryableApiError(new Error('internal server error'))).toBe(true);
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
    // After fixing SEPARATOR_REGEX, both now accept any number
    const lines = ['a', '--- 999 ---', 'b'];
    const blocks = splitFileBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].separator).toBe('--- 999 ---');
  });

  it('trims whitespace when matching separator', () => {
    const lines = ['a', '  --- 42 ---  ', 'b'];
    const blocks = splitFileBlocks(lines);
    expect(blocks).toHaveLength(2);
  });
});

// ─── createGeminiTranslator ─────────────────────────────────────────

describe('createGeminiTranslator', () => {
  it('creates a translator with default settings', () => {
    const settings = {
      llmApiKey: 'test-key',
      llmModel: 'gemini-2.0-flash',
      llmCustomPrompt: '',
      llmChunkSize: 30,
      llmTranslationUnit: 'chunk',
      DoNotTransHangul: true,
    };
    const translator = createGeminiTranslator(settings, 'ja', 'ko');
    expect(translator).toBeDefined();
    expect(typeof translator.translateText).toBe('function');
    expect(typeof translator.translateFileContent).toBe('function');
  });

  it('uses default chunk size when not provided', () => {
    const settings = {
      llmApiKey: 'key',
      llmModel: 'model',
      llmCustomPrompt: '',
      DoNotTransHangul: false,
    };
    const translator = createGeminiTranslator(settings, 'ja');
    expect(translator).toBeDefined();
  });
});

// ─── jpathIsMap (formatter.ts) ──────────────────────────────────────

import { jpathIsMap } from '../../src/ts/rpgmv/extract/formatter';

describe('jpathIsMap', () => {
  it('returns true for valid Map filenames', () => {
    expect(jpathIsMap('Map001.json')).toBe(true);
    expect(jpathIsMap('Map123.json')).toBe(true);
    expect(jpathIsMap('Map999.json')).toBe(true);
  });

  it('returns true for Map paths with directories', () => {
    expect(jpathIsMap('data/Map001.json')).toBe(true);
    expect(jpathIsMap('some/path/Map042.json')).toBe(true);
  });

  it('returns false for non-Map filenames', () => {
    expect(jpathIsMap('System.json')).toBe(false);
    expect(jpathIsMap('Actors.json')).toBe(false);
    expect(jpathIsMap('CommonEvents.json')).toBe(false);
  });

  it('returns false for names starting with Map but wrong length', () => {
    expect(jpathIsMap('Map1.json')).toBe(false);   // MapX = 4 chars, needs 6
    expect(jpathIsMap('Map12.json')).toBe(false);   // MapXX = 5 chars
    expect(jpathIsMap('Map1234.json')).toBe(false);  // too long
  });

  it('returns false for Map prefix with non-numeric suffix', () => {
    expect(jpathIsMap('MapABC.json')).toBe(false);
    expect(jpathIsMap('Mapxyz.json')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(jpathIsMap('')).toBe(false);
  });

  it('handles various extensions', () => {
    // jpathIsMap uses path.parse().name, so extension doesn't matter
    expect(jpathIsMap('Map001.txt')).toBe(true);
    expect(jpathIsMap('Map001')).toBe(true);
  });
});
