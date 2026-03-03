<template>
  <div class="verify-layout">
    <!-- Left: File list -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <input type="text" v-model="searchQuery" class="search-input" placeholder="파일 검색..." @input="updateFilteredFiles">
        <div class="filter-row">
          <label><input type="checkbox" v-model="filterIssues" @change="updateFilteredFiles"> 문제 있는 파일만</label>
          <span class="file-count">{{ filteredFiles.length }}/{{ files.length }}</span>
        </div>
      </div>
      <div class="file-list">
        <div v-for="item in filteredFiles" :key="item.realIdx"
          class="file-item" :class="{ active: item.realIdx === currentIdx }"
          @click="selectFile(item.realIdx)">
          <span>{{ item.file.name }}</span>
          <span v-if="item.file.repaired" class="badge badge-repaired">수정됨</span>
          <span v-if="item.file.errorCount > 0" class="badge badge-error">❌ {{ item.file.errorCount }}</span>
          <span v-if="item.file.warningCount > 0" class="badge badge-warn">⚠ {{ item.file.warningCount }}</span>
          <span v-if="item.file.issues.length === 0" class="badge badge-ok">✓</span>
        </div>
      </div>
    </aside>

    <!-- Right: Issues -->
    <main class="content">
      <div class="toolbar">
        <div class="summary" v-html="summaryHtml"></div>
        <div class="action-buttons">
          <span class="selection-count" v-if="selectedIssues.size > 0">{{ selectedIssues.size }}개 선택</span>
          <button :disabled="selectedIssues.size === 0" @click="revertSelected" title="선택한 항목을 원본 값으로 되돌립니다">선택 되돌리기</button>
          <button :disabled="!currentHasIssues" @click="repairCurrentFile">현재 파일 수정</button>
          <button :disabled="!anyHasIssues" @click="repairAll">전체 수정</button>
          <button @click="close">닫기</button>
        </div>
        <div class="status" :class="statusClass">{{ statusText }}</div>
      </div>

      <div class="issues-panel">
        <div class="issues-file-name">{{ currentFileName }}</div>
        <div v-if="currentIssues.length === 0" class="no-issues">
          ✓ 구조적 문제가 없습니다
        </div>
        <div v-for="(issue, i) in currentIssues" :key="i"
          class="issue-item" :class="[issue.severity, selectedIssues.has(i) ? 'selected' : '']">
          <label class="issue-checkbox" @click.stop="toggleIssue(i)">
            <input type="checkbox" :checked="selectedIssues.has(i)" tabindex="-1" @click.prevent>
          </label>
          <div class="issue-content">
            <div class="issue-header">
              <div class="issue-type">{{ typeLabel(issue.type) }}</div>
              <div class="issue-path">{{ issue.path }}</div>
            </div>
            <div class="issue-message">{{ issue.message }}</div>
            <div v-if="issue.origValue !== undefined || issue.transValue !== undefined" class="issue-values">
              <div class="value-row" v-if="issue.origValue !== undefined">
                <span class="value-label">원본:</span>
                <code class="value-content orig">{{ formatValue(issue.origValue) }}</code>
              </div>
              <div class="value-row" v-if="issue.transValue !== undefined">
                <span class="value-label">번역:</span>
                <code class="value-content trans">{{ formatValue(issue.transValue) }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../composables/useIpc'

interface VerifyIssue {
  path: string; type: string; severity: 'error' | 'warning'; message: string;
  origValue?: unknown; transValue?: unknown;
}
interface FileEntry {
  name: string; origPath: string; transPath: string;
  issues: VerifyIssue[]; errorCount: number; warningCount: number; repaired: boolean;
}

const files = ref<FileEntry[]>([])
const currentIdx = ref(0)
const searchQuery = ref('')
const filterIssues = ref(false)
const filteredFiles = ref<{ file: FileEntry; realIdx: number }[]>([])
const statusText = ref('')
const statusClass = ref('')
const selectedIssues = ref<Set<number>>(new Set())

const currentFileName = computed(() => files.value.length > 0 ? files.value[currentIdx.value].name : '')
const currentIssues = computed(() => files.value.length > 0 ? files.value[currentIdx.value].issues : [])
const currentHasIssues = computed(() => files.value.length > 0 && files.value[currentIdx.value].issues.length > 0)
const anyHasIssues = computed(() => files.value.some(f => f.issues.length > 0))

const typeLabels: Record<string, string> = {
  'array_length': '배열 길이 불일치', 'type_mismatch': '타입 불일치',
  'keys_added': '키 추가됨', 'keys_removed': '키 제거됨',
  'value_changed': '값 변경됨', 'string_changed': '번역 불가 문자열 변경',
  'control_char_mismatch': '제어문자 불일치', 'text_shift': '텍스트 줄밀림',
  'parse_error': 'JSON 파싱 오류'
}
function typeLabel(type: string) { return typeLabels[type] || type }

function formatValue(val: unknown): string {
  if (typeof val === 'string') return val.length > 100 ? val.substring(0, 100) + '...' : val
  return JSON.stringify(val)
}

const summaryHtml = computed(() => {
  if (files.value.length === 0) return '<span class="summary-error">비교할 파일이 없습니다.</span>'
  const ef = files.value.filter(f => f.errorCount > 0).length
  const wf = files.value.filter(f => f.warningCount > 0 && f.errorCount === 0).length
  const total = files.value.reduce((s, f) => s + f.issues.length, 0)
  if (total === 0) return `<span class="summary-ok">✓ 모든 파일의 JSON 구조가 일치합니다 (${files.value.length}개)</span>`
  const parts: string[] = []
  if (ef > 0) parts.push(`<span class="summary-error">❌ ${ef}개 파일에서 구조 오류</span>`)
  if (wf > 0) parts.push(`<span class="summary-warn">⚠ ${wf}개 파일에서 경고</span>`)
  parts.push(`<span class="summary-total">(전체 ${files.value.length}개, ${total}개 문제)</span>`)
  return parts.join(' \u00A0 ')
})

function loadFiles(dir: string) {
  files.value = []
  currentIdx.value = 0
  selectedIssues.value = new Set()

  const completedDir = window.nodePath.join(dir, 'Completed', 'data')
  const backupDir = window.nodePath.join(dir, 'Backup')
  let origDir: string, transDir: string
  if (window.nodeFs.existsSync(completedDir)) {
    origDir = window.nodeFs.existsSync(backupDir) ? backupDir : dir
    transDir = completedDir
  } else if (window.nodeFs.existsSync(backupDir)) {
    origDir = backupDir; transDir = dir
  } else { return }

  const transFiles = window.nodeFs.readdirSync(transDir).filter((f: string) => f.endsWith('.json'))
  for (const name of transFiles) {
    const origPath = window.nodePath.join(origDir, name)
    const transPath = window.nodePath.join(transDir, name)
    if (!window.nodeFs.existsSync(origPath)) continue
    try {
      let origData = window.nodeFs.readFileSync(origPath, 'utf-8')
      let transData = window.nodeFs.readFileSync(transPath, 'utf-8')
      if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
      if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
      const orig = JSON.parse(origData), trans = JSON.parse(transData)
      const issues: VerifyIssue[] = window.verify.verifyJsonIntegrity(orig, trans)
      files.value.push({
        name, origPath, transPath, issues,
        errorCount: issues.filter(i => i.severity === 'error').length,
        warningCount: issues.filter(i => i.severity === 'warning').length,
        repaired: false
      })
    } catch (e) {
      files.value.push({
        name, origPath, transPath,
        issues: [{ path: '$', type: 'parse_error', severity: 'error', message: `JSON 파싱 오류: ${(e as Error).message}` }],
        errorCount: 1, warningCount: 0, repaired: false
      })
    }
  }
  updateFilteredFiles()
}

function updateFilteredFiles() {
  const q = searchQuery.value.toLowerCase()
  filteredFiles.value = files.value
    .map((file, i) => ({ file, realIdx: i }))
    .filter(({ file }) => {
      if (q && !file.name.toLowerCase().includes(q)) return false
      if (filterIssues.value && file.issues.length === 0) return false
      return true
    })
}

function selectFile(idx: number) {
  currentIdx.value = idx
  selectedIssues.value = new Set()
}

function toggleIssue(i: number) {
  const s = new Set(selectedIssues.value)
  if (s.has(i)) s.delete(i); else s.add(i)
  selectedIssues.value = s
}

function getIndent(): number {
  return 4 * Number((globalThis as any).settings?.JsonChangeLine || 0)
}

function refreshFileIssues(idx: number) {
  const f = files.value[idx]
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    const issues: VerifyIssue[] = window.verify.verifyJsonIntegrity(orig, trans)
    f.issues = issues
    f.errorCount = issues.filter(i => i.severity === 'error').length
    f.warningCount = issues.filter(i => i.severity === 'warning').length
  } catch (e) {
    f.issues = [{ path: '$', type: 'parse_error', severity: 'error', message: `JSON 파싱 오류: ${(e as Error).message}` }]
    f.errorCount = 1; f.warningCount = 0
  }
}

function revertSelected() {
  const f = files.value[currentIdx.value]
  if (!f || selectedIssues.value.size === 0) return
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    let reverted = 0
    for (const idx of selectedIssues.value) {
      const issue = f.issues[idx]
      if (!issue || issue.path === '$') continue
      const origVal = window.verify.getAtPath(orig, issue.path)
      if (origVal !== undefined) {
        window.verify.setAtPath(trans, issue.path, JSON.parse(JSON.stringify(origVal)))
        reverted++
      }
    }
    if (reverted > 0) {
      const indent = getIndent()
      window.nodeFs.writeFileSync(f.transPath, JSON.stringify(trans, null, indent || undefined), 'utf-8')
      refreshFileIssues(currentIdx.value)
      f.repaired = true
      statusText.value = `✓ ${reverted}개 항목 되돌리기 완료 (남은 문제: ${f.issues.length}개)`
      statusClass.value = 'status-ok'
    } else {
      statusText.value = '되돌릴 수 있는 항목이 없습니다'
      statusClass.value = 'status-error'
    }
    selectedIssues.value = new Set()
    updateFilteredFiles()
  } catch (e) {
    statusText.value = `❌ 되돌리기 실패: ${(e as Error).message}`
    statusClass.value = 'status-error'
  }
}

function repairFile(idx: number): { success: boolean; fixed: number; remaining: number; error?: string } {
  const f = files.value[idx]
  if (f.issues.length === 0) return { success: false, fixed: 0, remaining: 0, error: '문제가 없는 파일' }
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    const beforeCount = f.issues.length
    const repaired = window.verify.repairJson(orig, trans)
    const indent = getIndent()
    const output = JSON.stringify(repaired, null, indent || undefined)
    window.nodeFs.writeFileSync(f.transPath, output, 'utf-8')
    refreshFileIssues(idx)
    f.repaired = true
    const fixed = beforeCount - f.issues.length
    return { success: true, fixed, remaining: f.issues.length }
  } catch (e) { return { success: false, fixed: 0, remaining: f.issues.length, error: (e as Error).message } }
}

function repairCurrentFile() {
  const result = repairFile(currentIdx.value)
  if (result.success) {
    if (result.remaining > 0) {
      statusText.value = `✓ ${result.fixed}개 수정 완료, ${result.remaining}개 항목은 번역 품질 문제로 자동 수정 불가`
    } else {
      statusText.value = `✓ ${files.value[currentIdx.value].name} 수정 완료 (${result.fixed}개 문제 해결)`
    }
    statusClass.value = 'status-ok'
  } else {
    statusText.value = `❌ 수정 실패: ${result.error}`
    statusClass.value = 'status-error'
  }
  selectedIssues.value = new Set()
  updateFilteredFiles()
}

function repairAll() {
  let repaired = 0, failed = 0, totalFixed = 0, totalRemaining = 0
  for (let i = 0; i < files.value.length; i++) {
    if (files.value[i].issues.length > 0) {
      const r = repairFile(i)
      if (r.success) { repaired++; totalFixed += r.fixed; totalRemaining += r.remaining }
      else failed++
    }
  }
  if (failed === 0) {
    if (totalRemaining > 0) {
      statusText.value = `✓ ${repaired}개 파일, ${totalFixed}개 문제 수정 완료 (${totalRemaining}개 항목은 수동 확인 필요)`
    } else {
      statusText.value = `✓ ${repaired}개 파일, ${totalFixed}개 문제 모두 수정 완료`
    }
    statusClass.value = 'status-ok'
  } else {
    statusText.value = `${repaired}개 수정, ${failed}개 실패`
    statusClass.value = 'status-error'
  }
  selectedIssues.value = new Set()
  updateFilteredFiles()
}

function close() { window.close() }

onMounted(() => {
  api.on('initVerify', (dir: string) => loadFiles(dir))
  api.on('verifySettings', (s: unknown) => { (globalThis as any).settings = s })
  api.send('verifyReady')
})
onUnmounted(() => {
  api.removeAllListeners('initVerify')
  api.removeAllListeners('verifySettings')
})
</script>

<style scoped>
.verify-layout { display: flex; height: 100vh; }
.sidebar { width: 240px; border-right: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; }
.sidebar-header { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.search-input {
  width: 100%; padding: 6px 8px; background: var(--Highlight1); border: var(--border);
  border-radius: 6px; color: var(--mainColor); font-size: 12px; font-family: inherit; margin-bottom: 6px;
}
.filter-row { display: flex; gap: 8px; align-items: center; font-size: 11px; opacity: 0.6; }
.file-count { margin-left: auto; }
.file-list { flex: 1; overflow-y: auto; }
.file-item {
  padding: 8px 10px; cursor: pointer; font-size: 12px;
  display: flex; align-items: center; gap: 6px; transition: var(--transition);
  border-bottom: 1px solid rgba(255,255,255,0.02);
}
.file-item:hover { background: rgba(255,255,255,0.04); }
.file-item.active { background: rgba(124,111,219,0.15); border-left: 3px solid var(--accent); }
.badge { font-size: 9px; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
.badge-error { background: rgba(255,85,85,0.2); color: #ff5555; }
.badge-warn { background: rgba(255,184,108,0.2); color: #ffb86c; }
.badge-ok { background: rgba(80,250,123,0.2); color: #50fa7b; }
.badge-repaired { background: rgba(241,250,140,0.2); color: #f1fa8c; }

.content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.toolbar {
  padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.summary { font-size: 12px; }
.action-buttons { display: flex; gap: 4px; align-items: center; }
.action-buttons button {
  padding: 4px 10px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition);
}
.action-buttons button:hover { background: rgba(255,255,255,0.08); }
.action-buttons button:disabled { opacity: 0.3; cursor: default; }
.selection-count { font-size: 11px; opacity: 0.5; }
.status { font-size: 11px; margin-left: auto; }
.status-ok { color: #50fa7b; }
.status-error { color: #ff5555; }

.issues-panel { flex: 1; overflow-y: auto; padding: 12px; }
.issues-file-name { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.no-issues { font-size: 13px; color: #50fa7b; opacity: 0.6; padding: 20px; text-align: center; }
.issue-item {
  margin-bottom: 8px; padding: 10px 12px 10px 44px; border-radius: 6px;
  background: var(--Highlight1); border-left: 3px solid transparent;
  position: relative; transition: var(--transition);
}
.issue-item.error { border-left-color: #ff5555; }
.issue-item.warning { border-left-color: #ffb86c; }
.issue-item.selected { background: rgba(124,111,219,0.08); border-color: rgba(124,111,219,0.5); }
.issue-checkbox {
  position: absolute; top: 0; left: 0; width: 36px; height: 100%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0.4; transition: var(--transition);
}
.issue-checkbox:hover { opacity: 1; background: rgba(124,111,219,0.15); border-radius: 6px 0 0 6px; }
.issue-checkbox input[type="checkbox"] {
  width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent);
}
.issue-item.selected .issue-checkbox { opacity: 1; }
.issue-content { flex: 1; }
.issue-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.issue-path { font-size: 11px; opacity: 0.4; font-family: monospace; }
.issue-type { font-size: 12px; font-weight: 600; white-space: nowrap; }
.issue-message { font-size: 12px; opacity: 0.7; }
.issue-values { margin-top: 6px; font-size: 11px; }
.value-row { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 2px; }
.value-label { font-weight: 600; opacity: 0.5; min-width: 36px; }
.value-content {
  background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 3px;
  font-family: monospace; font-size: 11px; word-break: break-all;
  max-height: 60px; overflow-y: auto; display: block;
}
.value-content.orig { color: #8be9fd; }
.value-content.trans { color: #f1fa8c; }

:deep(.summary-error) { color: #ff5555; }
:deep(.summary-warn) { color: #f1fa8c; }
:deep(.summary-ok) { color: #50fa7b; }
:deep(.summary-total) { opacity: 0.4; }
</style>
