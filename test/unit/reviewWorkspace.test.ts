import { beforeEach, describe, expect, it } from 'vitest'
import { findReviewFileIndex, resetReviewWorkspace, reviewWorkspace, normalizeReviewDirectory } from '../../src/renderer/composables/useReviewWorkspace'

describe('review workspace file context', () => {
  beforeEach(() => resetReviewWorkspace())

  it('uses the same project identity for native picker and overview navigation paths', () => {
    resetReviewWorkspace('C:\\game\\data')
    expect(reviewWorkspace.projectDir).toBe(normalizeReviewDirectory('C:/game/data'))
    expect(reviewWorkspace.projectDir).toBe(normalizeReviewDirectory('C:\\game\\data'))
  })

  it('matches a JSON file to its extracted text across platform paths and casing', () => {
    const files = [{ name: 'Map001.txt' }, { name: 'Map002.txt' }]
    expect(findReviewFileIndex(files, 'C:\\game\\Completed\\data\\map002.JSON')).toBe(1)
    expect(findReviewFileIndex([{ name: 'Map001.json' }], '/game/Extract/Map001.txt')).toBe(0)
  })

  it('does not guess a text block or a similarly prefixed file for unmapped JSON', () => {
    expect(findReviewFileIndex([{ name: 'Map001.txt' }], 'Map001.names.json')).toBe(-1)
    expect(findReviewFileIndex([{ name: 'CommonEvents.txt' }], 'Map001.json')).toBe(-1)
    expect(findReviewFileIndex([{ name: '.txt' }], '')).toBe(-1)
  })

  it('clears stale diagnostics and editing context when replacing a project', () => {
    resetReviewWorkspace('/old')
    reviewWorkspace.focusedFile = 'Map001.txt'
    Object.assign(reviewWorkspace.text, { dirty: true, busy: true, loaded: true, fileCount: 4, mismatchCount: 2 })
    Object.assign(reviewWorkspace.structure, { loaded: true, issueCount: 8, busy: true })
    resetReviewWorkspace('/new')
    expect(reviewWorkspace.projectDir).toBe('/new')
    expect(reviewWorkspace.focusedFile).toBe('')
    expect(reviewWorkspace.text).toEqual({ fileCount: 0, mismatchCount: 0, untranslatedCount: 0, dirty: false, busy: false, loaded: false })
    expect(reviewWorkspace.structure).toEqual({ fileCount: 0, issueCount: 0, busy: false, loaded: false })
  })
})
