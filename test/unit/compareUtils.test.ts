import { describe, it, expect } from 'vitest'
import { splitBlocks, checkMismatch, autoFixBlock, isBlockUntranslated, removeDuplicateHeaders, blocksToLines, checkMismatchBlocks, hasAnyUntranslatedBlock } from '../../src/renderer/compareUtils'
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

describe('removeDuplicateHeaders', () => {
  it('removes empty block when duplicate separator exists', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: [] },
      { sep: '--- 1 ---', lines: ['hello'] },
      { sep: '--- 2 ---', lines: ['world'] }
    ]
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(1)
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: ['hello'] },
      { sep: '--- 2 ---', lines: ['world'] }
    ])
  })

  it('removes later empty block when first has content', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: ['hello'] },
      { sep: '--- 1 ---', lines: [] },
      { sep: '--- 2 ---', lines: ['world'] }
    ]
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(1)
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: ['hello'] },
      { sep: '--- 2 ---', lines: ['world'] }
    ])
  })

  it('does not merge when both blocks have content', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: ['a'] },
      { sep: '--- 1 ---', lines: ['b'] }
    ]
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(0)
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: ['a'] },
      { sep: '--- 1 ---', lines: ['b'] }
    ])
  })

  it('returns 0 when no duplicates', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: ['a'] },
      { sep: '--- 2 ---', lines: ['b'] }
    ]
    expect(removeDuplicateHeaders(blocks)).toBe(0)
    expect(blocks.length).toBe(2)
  })

  it('handles blocks without separators', () => {
    const blocks: Block[] = [
      { sep: '', lines: ['a'] },
      { sep: '', lines: ['b'] }
    ]
    // Empty strings are falsy, so no duplicate sep detected
    expect(removeDuplicateHeaders(blocks)).toBe(0)
  })

  it('handles multiple consecutive duplicates', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: [] },
      { sep: '--- 1 ---', lines: [] },
      { sep: '--- 1 ---', lines: ['content'] }
    ]
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(2)
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: ['content'] }
    ])
  })

  it('does not cascade-merge after removing empty duplicate between content blocks', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: ['a'] },
      { sep: '--- 1 ---', lines: [] },
      { sep: '--- 1 ---', lines: ['b'] }
    ]
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(1)
    expect(blocks).toEqual([
      { sep: '--- 1 ---', lines: ['a'] },
      { sep: '--- 1 ---', lines: ['b'] }
    ])
  })

  it('end-to-end: removes one header from back-to-back duplicates', () => {
    const lines = ['--- 101 ---', '--- 101 ---', '[이름]', '대사']
    const blocks = splitBlocks(lines)
    expect(blocks).toEqual([
      { sep: '--- 101 ---', lines: [] },
      { sep: '--- 101 ---', lines: ['[이름]', '대사'] }
    ])
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(1)
    expect(blocksToLines(blocks)).toEqual(['--- 101 ---', '[이름]', '대사'])
  })

  it('removes multiple different duplicate headers in one pass', () => {
    const blocks: Block[] = [
      { sep: '--- 100 ---', lines: ['t1'] },
      { sep: '--- 101 ---', lines: [] },
      { sep: '--- 101 ---', lines: ['t2'] },
      { sep: '--- 102 ---', lines: [] },
      { sep: '--- 102 ---', lines: ['t3'] }
    ]
    const removed = removeDuplicateHeaders(blocks)
    expect(removed).toBe(2)
    expect(blocks).toEqual([
      { sep: '--- 100 ---', lines: ['t1'] },
      { sep: '--- 101 ---', lines: ['t2'] },
      { sep: '--- 102 ---', lines: ['t3'] }
    ])
  })
})

describe('blocksToLines', () => {
  it('reconstructs lines from blocks with separators', () => {
    const blocks: Block[] = [
      { sep: '--- 1 ---', lines: ['hello', 'world'] },
      { sep: '--- 2 ---', lines: ['foo'] }
    ]
    expect(blocksToLines(blocks)).toEqual(['--- 1 ---', 'hello', 'world', '--- 2 ---', 'foo'])
  })

  it('handles blocks without separators', () => {
    const blocks: Block[] = [{ sep: '', lines: ['a', 'b'] }]
    expect(blocksToLines(blocks)).toEqual(['a', 'b'])
  })

  it('handles empty blocks array', () => {
    expect(blocksToLines([])).toEqual([])
  })

  it('handles blocks with empty lines', () => {
    const blocks: Block[] = [{ sep: '--- 1 ---', lines: [] }]
    expect(blocksToLines(blocks)).toEqual(['--- 1 ---'])
  })
})

describe('checkMismatchBlocks', () => {
  it('returns false for matching blocks', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['a'] }]
    const tb: Block[] = [{ sep: '--- 1 ---', lines: ['x'] }]
    expect(checkMismatchBlocks(ob, tb)).toBe(false)
  })

  it('returns true for different block count', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['a'] }]
    const tb: Block[] = []
    expect(checkMismatchBlocks(ob, tb)).toBe(true)
  })

  it('returns true for different line count', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['a', 'b'] }]
    const tb: Block[] = [{ sep: '--- 1 ---', lines: ['x'] }]
    expect(checkMismatchBlocks(ob, tb)).toBe(true)
  })

  it('returns true for different separator', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['a'] }]
    const tb: Block[] = [{ sep: '--- 2 ---', lines: ['x'] }]
    expect(checkMismatchBlocks(ob, tb)).toBe(true)
  })

  it('is consistent with checkMismatch', () => {
    const lines1 = ['--- 1 ---', 'a', '--- 2 ---', 'b']
    const lines2 = ['--- 1 ---', 'x', '--- 2 ---', 'y']
    expect(checkMismatchBlocks(splitBlocks(lines1), splitBlocks(lines2))).toBe(checkMismatch(lines1, lines2))
  })
})

describe('hasAnyUntranslatedBlock', () => {
  it('returns true when a block is untranslated', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['hello'] }]
    const tb: Block[] = [{ sep: '--- 1 ---', lines: ['hello'] }]
    expect(hasAnyUntranslatedBlock(ob, tb)).toBe(true)
  })

  it('returns false when blocks are translated', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['hello'] }]
    const tb: Block[] = [{ sep: '--- 1 ---', lines: ['안녕'] }]
    expect(hasAnyUntranslatedBlock(ob, tb)).toBe(false)
  })

  it('returns false for empty blocks', () => {
    expect(hasAnyUntranslatedBlock([], [])).toBe(false)
  })

  it('returns false when content differs in line count', () => {
    const ob: Block[] = [{ sep: '--- 1 ---', lines: ['hello'] }]
    const tb: Block[] = [{ sep: '--- 1 ---', lines: ['hello', 'extra'] }]
    expect(hasAnyUntranslatedBlock(ob, tb)).toBe(false)
  })
})
