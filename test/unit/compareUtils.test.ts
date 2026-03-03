import { describe, it, expect } from 'vitest'
import { splitBlocks, checkMismatch, autoFixBlock, isBlockUntranslated } from '../../src/renderer/compareUtils'
import type { Block } from '../../src/renderer/compareUtils'

describe('splitBlocks', () => {
  it('splits lines at separator markers', () => {
    const lines = ['--- 1 ---', 'hello', 'world', '--- 2 ---', 'foo']
    const blocks = splitBlocks(lines)
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: ['hello', 'world'] },
      { sep: '--- 2 ---', lines: ['foo'] },
    ])
  })

  it('handles lines before first separator', () => {
    const lines = ['before', '--- 1 ---', 'after']
    const blocks = splitBlocks(lines)
    expect(blocks).toEqual([
      { sep: '', lines: ['before'] },
      { sep: '--- 1 ---', lines: ['after'] },
    ])
  })

  it('handles empty input', () => {
    expect(splitBlocks([])).toEqual([])
  })

  it('handles lines with no separators', () => {
    const blocks = splitBlocks(['a', 'b', 'c'])
    expect(blocks).toEqual([{ sep: '', lines: ['a', 'b', 'c'] }])
  })

  it('handles consecutive separators', () => {
    const blocks = splitBlocks(['--- 1 ---', '--- 2 ---', 'text'])
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: [] },
      { sep: '--- 2 ---', lines: ['text'] },
    ])
  })
})

describe('checkMismatch', () => {
  it('returns false for matching blocks', () => {
    const orig = ['--- 1 ---', 'line1', 'line2', '--- 2 ---', 'lineA']
    const trans = ['--- 1 ---', 'trans1', 'trans2', '--- 2 ---', 'transA']
    expect(checkMismatch(orig, trans)).toBe(false)
  })

  it('returns true when block count differs', () => {
    const orig = ['--- 1 ---', 'a', '--- 2 ---', 'b']
    const trans = ['--- 1 ---', 'a']
    expect(checkMismatch(orig, trans)).toBe(true)
  })

  it('returns true when line count within a block differs', () => {
    const orig = ['--- 1 ---', 'a', 'b']
    const trans = ['--- 1 ---', 'a']
    expect(checkMismatch(orig, trans)).toBe(true)
  })

  it('returns true when separator mismatch', () => {
    const orig = ['--- 1 ---', 'a']
    const trans = ['--- 2 ---', 'a']
    expect(checkMismatch(orig, trans)).toBe(true)
  })

  it('returns false for identical empty inputs', () => {
    expect(checkMismatch([], [])).toBe(false)
  })
})

describe('isBlockUntranslated', () => {
  it('returns true when lines are identical', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['hello', 'world'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['hello', 'world'] }
    expect(isBlockUntranslated(orig, trans)).toBe(true)
  })

  it('returns false when lines differ', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['hello'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['안녕'] }
    expect(isBlockUntranslated(orig, trans)).toBe(false)
  })

  it('returns false when line counts differ', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['a', 'b'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['a'] }
    expect(isBlockUntranslated(orig, trans)).toBe(false)
  })

  it('returns false for null blocks', () => {
    expect(isBlockUntranslated(null as any, { sep: '', lines: [] })).toBe(false)
    expect(isBlockUntranslated({ sep: '', lines: [] }, null as any)).toBe(false)
  })

  it('returns true for empty lines in both', () => {
    const orig: Block = { sep: '--- 1 ---', lines: [''] }
    const trans: Block = { sep: '--- 1 ---', lines: [''] }
    expect(isBlockUntranslated(orig, trans)).toBe(false) // empty lines have no translatable text
  })

  it('returns false for special-char-only identical blocks', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['!!!', '***', '---'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['!!!', '***', '---'] }
    expect(isBlockUntranslated(orig, trans)).toBe(false) // no translatable characters
  })

  it('returns false for number-only identical blocks', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['12345', '67890'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['12345', '67890'] }
    expect(isBlockUntranslated(orig, trans)).toBe(false)
  })

  it('returns true for identical blocks with Japanese text', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['こんにちは'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['こんにちは'] }
    expect(isBlockUntranslated(orig, trans)).toBe(true)
  })

  it('returns true for identical blocks with Korean text', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['안녕하세요'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['안녕하세요'] }
    expect(isBlockUntranslated(orig, trans)).toBe(true)
  })

  it('returns true for identical blocks with CJK characters', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['你好世界'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['你好世界'] }
    expect(isBlockUntranslated(orig, trans)).toBe(true)
  })

  it('returns true for identical blocks with English text', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['Hello world'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['Hello world'] }
    expect(isBlockUntranslated(orig, trans)).toBe(true)
  })

  it('returns true for blocks with control codes containing letters', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['\\C[2]', '100'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['\\C[2]', '100'] }
    // 'C' is an alphabet character, so this block is considered translatable
    expect(isBlockUntranslated(orig, trans)).toBe(true)
  })
})

describe('autoFixBlock', () => {
  it('adds empty line when trans is 1 line short', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['a', 'b'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['x'] }
    expect(autoFixBlock(orig, trans)).toBe('빈줄 추가')
    expect(trans.lines).toEqual(['x', ''])
  })

  it('removes trailing empty line when trans is 1 line long', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['a'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['x', ''] }
    expect(autoFixBlock(orig, trans)).toBe('빈줄 제거')
    expect(trans.lines).toEqual(['x'])
  })

  it('does not remove trailing non-empty line', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['a'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['x', 'y'] }
    expect(autoFixBlock(orig, trans)).toBeNull()
    expect(trans.lines).toEqual(['x', 'y'])
  })

  it('fixes separator mismatch', () => {
    const orig: Block = { sep: '--- 101 ---', lines: ['a'] }
    const trans: Block = { sep: '--- 102 ---', lines: ['x'] }
    expect(autoFixBlock(orig, trans)).toBe('구분자 수정')
    expect(trans.sep).toBe('--- 101 ---')
  })

  it('fixes separator + adds empty line combined', () => {
    const orig: Block = { sep: '--- 101 ---', lines: ['a', 'b'] }
    const trans: Block = { sep: '--- 102 ---', lines: ['x'] }
    expect(autoFixBlock(orig, trans)).toBe('구분자 수정 + 빈줄 추가')
    expect(trans.sep).toBe('--- 101 ---')
    expect(trans.lines).toEqual(['x', ''])
  })

  it('fixes separator + removes trailing empty combined', () => {
    const orig: Block = { sep: '--- 101 ---', lines: ['a'] }
    const trans: Block = { sep: '--- 102 ---', lines: ['x', ''] }
    expect(autoFixBlock(orig, trans)).toBe('구분자 수정 + 빈줄 제거')
    expect(trans.sep).toBe('--- 101 ---')
    expect(trans.lines).toEqual(['x'])
  })

  it('returns null when nothing to fix', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['a'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['x'] }
    expect(autoFixBlock(orig, trans)).toBeNull()
  })

  it('returns null for null blocks', () => {
    expect(autoFixBlock(null as any, { sep: '', lines: [] })).toBeNull()
    expect(autoFixBlock({ sep: '', lines: [] }, null as any)).toBeNull()
  })

  it('does not fix separator when orig has no sep', () => {
    const orig: Block = { sep: '', lines: ['a'] }
    const trans: Block = { sep: '--- 1 ---', lines: ['x'] }
    expect(autoFixBlock(orig, trans)).toBeNull()
  })

  it('does not fix separator when trans has no sep', () => {
    const orig: Block = { sep: '--- 1 ---', lines: ['a'] }
    const trans: Block = { sep: '', lines: ['x'] }
    expect(autoFixBlock(orig, trans)).toBeNull()
  })
})
