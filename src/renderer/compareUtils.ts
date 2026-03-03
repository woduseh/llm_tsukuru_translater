/**
 * Pure logic for the LLM Compare page — block splitting, mismatch detection,
 * auto-fix, and untranslated detection. Extracted for unit-testing without DOM/Vue.
 */

const SEP_RE = /^---\s*\d+\s*---$/

export interface Block { sep: string; lines: string[] }

/** Split a flat array of text lines into separator-delimited blocks. */
export function splitBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let curSep = '', curLines: string[] = []
  for (const line of lines) {
    if (SEP_RE.test(line.trim())) {
      if (curSep || curLines.length > 0) blocks.push({ sep: curSep, lines: [...curLines] })
      curSep = line; curLines = []
    } else { curLines.push(line) }
  }
  if (curSep || curLines.length > 0) blocks.push({ sep: curSep, lines: curLines })
  return blocks
}

/** Check whether orig and trans have a block-level mismatch (count or line-count). */
export function checkMismatch(origLines: string[], transLines: string[]): boolean {
  const ob = splitBlocks(origLines), tb = splitBlocks(transLines)
  if (ob.length !== tb.length) return true
  for (let i = 0; i < ob.length; i++) {
    if (ob[i].sep !== tb[i].sep || ob[i].lines.length !== tb[i].lines.length) return true
  }
  return false
}

/**
 * Regex matching at least one translatable character (alphabet, CJK, Korean, Japanese kana).
 * Blocks containing only special characters/numbers are not considered translatable.
 */
const TRANSLATABLE_RE = /[a-zA-Z\u3000-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF]/

/** Whether a block is untranslated (orig and trans content are identical). */
export function isBlockUntranslated(origBlock: Block, transBlock: Block): boolean {
  if (!origBlock || !transBlock) return false
  if (origBlock.lines.length !== transBlock.lines.length) return false
  if (!origBlock.lines.every((line, i) => line === transBlock.lines[i])) return false
  // Identical blocks are only "untranslated" if they contain translatable text
  return origBlock.lines.some(line => TRANSLATABLE_RE.test(line))
}

/**
 * Auto-fix a single block. Mutates transBlock if fixable. Returns description of fix applied, or null.
 * Fixes (in priority order):
 * 1. Separator mismatch → align to orig
 * 2. Trans 1 line short → append empty line
 * 3. Trans 1 line long + last line empty → remove trailing empty line
 */
export function autoFixBlock(origBlock: Block, transBlock: Block): string | null {
  if (!origBlock || !transBlock) return null
  let fix: string | null = null

  // Fix separator mismatch
  if (origBlock.sep !== transBlock.sep && origBlock.sep && transBlock.sep) {
    transBlock.sep = origBlock.sep
    fix = '구분자 수정'
  }

  // Fix line count: trans 1 line short → add empty line
  if (origBlock.lines.length === transBlock.lines.length + 1) {
    transBlock.lines.push('')
    return fix ? fix + ' + 빈줄 추가' : '빈줄 추가'
  }

  // Fix line count: trans 1 line long + last line empty → remove trailing empty
  if (origBlock.lines.length === transBlock.lines.length - 1 && transBlock.lines[transBlock.lines.length - 1] === '') {
    transBlock.lines.pop()
    return fix ? fix + ' + 빈줄 제거' : '빈줄 제거'
  }

  return fix
}

/**
 * Remove duplicate consecutive separators from a block array.
 * When two adjacent blocks share the same separator, the empty one is removed.
 * If both have content, the earlier (empty-lined or shorter) block is removed and
 * its lines are prepended to the next block.
 * Mutates the array in-place. Returns the number of removed blocks.
 */
export function removeDuplicateHeaders(blocks: Block[]): number {
  let removed = 0
  for (let i = blocks.length - 1; i > 0; i--) {
    const prev = blocks[i - 1], cur = blocks[i]
    if (!prev.sep || prev.sep !== cur.sep) continue
    // Duplicate separator found — keep the block with content
    if (prev.lines.length === 0 || prev.lines.every(l => l === '')) {
      blocks.splice(i - 1, 1)
    } else if (cur.lines.length === 0 || cur.lines.every(l => l === '')) {
      blocks.splice(i, 1)
    } else {
      // Both have content — merge into the later block
      cur.lines = [...prev.lines, ...cur.lines]
      blocks.splice(i - 1, 1)
    }
    removed++
  }
  return removed
}

/** Reconstruct flat lines from blocks. */
export function blocksToLines(blocks: Block[]): string[] {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.sep) parts.push(block.sep)
    parts.push(...block.lines)
  }
  return parts
}

/** Check mismatch from pre-split blocks (avoids redundant splitting). */
export function checkMismatchBlocks(origBlocks: Block[], transBlocks: Block[]): boolean {
  if (origBlocks.length !== transBlocks.length) return true
  for (let i = 0; i < origBlocks.length; i++) {
    if (origBlocks[i].sep !== transBlocks[i].sep || origBlocks[i].lines.length !== transBlocks[i].lines.length) return true
  }
  return false
}

/** Check if any block pair is untranslated from pre-split blocks. */
export function hasAnyUntranslatedBlock(origBlocks: Block[], transBlocks: Block[]): boolean {
  const len = Math.min(origBlocks.length, transBlocks.length)
  for (let i = 0; i < len; i++) {
    if (isBlockUntranslated(origBlocks[i], transBlocks[i])) return true
  }
  return false
}
