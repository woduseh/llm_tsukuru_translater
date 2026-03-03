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
