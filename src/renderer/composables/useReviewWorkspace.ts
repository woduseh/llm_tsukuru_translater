import { reactive } from 'vue'

/** Shared summaries and file context; editable content stays in the kept-alive views. */
export const reviewWorkspace = reactive({
  projectDir: '',
  focusedFile: '',
  text: { fileCount: 0, mismatchCount: 0, untranslatedCount: 0, dirty: false, busy: false, loaded: false },
  structure: { fileCount: 0, issueCount: 0, busy: false, loaded: false },
})

export function resetReviewWorkspace(projectDir = '') {
  reviewWorkspace.projectDir = normalizeReviewDirectory(projectDir)
  reviewWorkspace.focusedFile = ''
  Object.assign(reviewWorkspace.text, {
    fileCount: 0, mismatchCount: 0, untranslatedCount: 0, dirty: false, busy: false, loaded: false,
  })
  Object.assign(reviewWorkspace.structure, { fileCount: 0, issueCount: 0, busy: false, loaded: false })
}

export function normalizeReviewDirectory(dir: string): string {
  return dir.replaceAll('\\', '/')
}

export function reviewFileStem(name: string): string {
  return (name.split(/[\\/]/).pop() ?? '').replace(/\.(txt|json)$/i, '').toLowerCase()
}

/** Only exact file stems match. A JSON path does not reliably identify a text block. */
export function findReviewFileIndex(files: readonly { name: string }[], focusedFile: string): number {
  const stem = reviewFileStem(focusedFile)
  return stem ? files.findIndex(file => reviewFileStem(file.name) === stem) : -1
}
