<template>
  <div class="verify-layout">
    <!-- Left: File list -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <input type="text" v-model="searchQuery" class="search-input" placeholder="파일 검색..." @input="updateFilteredFiles">
        <div class="filter-row">
          <label><input type="checkbox" v-model="filterErrors" @change="updateFilteredFiles"> 오류</label>
          <label><input type="checkbox" v-model="filterWarnings" @change="updateFilteredFiles"> 경고</label>
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
          <button :disabled="!llmButtonEnabled" @click="llmRepairShift" title="줄밀림 위치의 원본 텍스트를 LLM으로 재번역합니다">
            {{ llmButtonText }}
          </button>
          <button :disabled="!currentHasIssues" @click="repairCurrentFile">현재 파일 수정</button>
          <button :disabled="!anyHasIssues" @click="repairAll">전체 수정</button>
          <button @click="close">닫기</button>
        </div>
        <div class="status" :class="statusClass">{{ statusText }}</div>
      </div>

      <div class="issues-panel">
        <div class="issues-file-name">{{ currentFileName }}</div>

        <!-- 심각도 필터 탭 -->
        <div v-if="currentIssues.length > 0" class="severity-tabs">
          <button :class="{ active: issueSeverityFilter === 'all' }" @click="issueSeverityFilter = 'all'">
            전체 ({{ currentIssues.length }})
          </button>
          <button :class="{ active: issueSeverityFilter === 'error' }" @click="issueSeverityFilter = 'error'">
            ❌ 오류 ({{ currentErrorCount }})
          </button>
          <button :class="{ active: issueSeverityFilter === 'warning' }" @click="issueSeverityFilter = 'warning'">
            ⚠ 경고 ({{ currentWarningCount }})
          </button>
        </div>

        <!-- LLM 재번역 미리보기 -->
        <div v-if="llmRepairResults.length > 0" class="llm-preview">
          <div class="llm-preview-header">
            <span class="llm-preview-title">🔄 LLM 재번역 미리보기 ({{ llmRepairResults.length }}건)</span>
            <div class="llm-preview-actions">
              <button @click="applyLlmRepair">전체 적용</button>
              <button @click="llmRepairResults = []">취소</button>
            </div>
          </div>
          <div v-for="(item, i) in llmRepairResults" :key="i" class="llm-preview-item">
            <div class="issue-path" style="margin-bottom: 4px;">{{ item.path }}</div>
            <div class="value-row">
              <span class="value-label">원본:</span>
              <code class="value-content orig">{{ item.origText }}</code>
            </div>
            <div class="value-row">
              <span class="value-label">현재:</span>
              <code class="value-content trans">{{ item.currentText }}</code>
            </div>
            <div class="value-row">
              <span class="value-label">새 번역:</span>
              <code class="value-content new-trans">{{ item.newText }}</code>
            </div>
          </div>
        </div>

        <div v-if="currentIssues.length === 0 && llmRepairResults.length === 0" class="no-issues">
          <div class="no-issues-header">✓ 구조적 문제가 없습니다</div>
          <div v-if="previewSamples.length > 0" class="preview-section">
            <div class="preview-title">번역 미리보기 ({{ previewSamples.length }}건)</div>
            <div v-for="(s, i) in previewSamples" :key="i" class="preview-item">
              <div class="preview-path">{{ s.path }}</div>
              <div class="value-row">
                <span class="value-label">원본:</span>
                <code class="value-content orig">{{ s.orig }}</code>
              </div>
              <div class="value-row">
                <span class="value-label">번역:</span>
                <code class="value-content trans">{{ s.trans }}</code>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="filteredIssueItems.length === 0 && currentIssues.length > 0" class="no-issues-filter">
          선택한 유형의 문제가 없습니다
        </div>
        <div v-for="item in filteredIssueItems" :key="item.origIdx"
          class="issue-item" :class="[item.issue.severity, selectedIssues.has(item.origIdx) ? 'selected' : '']">
          <div class="issue-checkbox" @click.stop="toggleIssue(item.origIdx)">
            <input type="checkbox" :checked="selectedIssues.has(item.origIdx)" tabindex="-1" @click.prevent>
          </div>
          <div class="issue-content">
            <div class="issue-header">
              <div class="issue-type">{{ typeLabel(item.issue.type) }}</div>
              <div class="issue-path">{{ item.issue.path }}</div>
            </div>
            <div class="issue-message">{{ item.issue.message }}</div>
            <div v-if="item.issue.origValue !== undefined || item.issue.transValue !== undefined" class="issue-values">
              <div class="value-row" v-if="item.issue.origValue !== undefined">
                <span class="value-label">원본:</span>
                <code class="value-content orig">{{ formatValue(item.issue.origValue) }}</code>
              </div>
              <div class="value-row" v-if="item.issue.transValue !== undefined">
                <span class="value-label">번역:</span>
                <code class="value-content trans">{{ formatValue(item.issue.transValue) }}</code>
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
const filterErrors = ref(false)
const filterWarnings = ref(false)
const filteredFiles = ref<{ file: FileEntry; realIdx: number }[]>([])
const statusText = ref('')
const statusClass = ref('')
const selectedIssues = ref<Set<number>>(new Set())
const llmRepairing = ref(false)
const llmProgress = ref('')
const llmRepairResults = ref<{ path: string; origText: string; currentText: string; newText: string }[]>([])
const loading = ref(true)
const issueSeverityFilter = ref<'all' | 'error' | 'warning'>('all')
const previewSamples = ref<{ orig: string; trans: string; path: string }[]>([])

/**
 * Local setAtPath — avoids contextBridge structured-clone which discards mutations.
 * Navigates a JSON path (e.g. "$.events[0].pages[1].list[5].parameters[0]") and sets value.
 */
function localSetAtPath(obj: unknown, jsonPath: string, value: unknown): boolean {
  const cleaned = jsonPath.replace(/^\$\.?/, '')
  if (!cleaned) return false
  const parts = cleaned.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
    .map(p => /^\d+$/.test(p) ? Number(p) : p)
  if (parts.length === 0) return false
  let current: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[parts[i] as string]
  }
  if (current == null || typeof current !== 'object') return false
  ;(current as Record<string, unknown>)[parts[parts.length - 1] as string] = value
  return true
}

const currentFileName = computed(() => files.value.length > 0 ? files.value[currentIdx.value].name : '')
const currentIssues = computed(() => files.value.length > 0 ? files.value[currentIdx.value].issues : [])
const currentHasIssues = computed(() => files.value.length > 0 && files.value[currentIdx.value].issues.length > 0)
const currentErrorCount = computed(() => files.value.length > 0 ? files.value[currentIdx.value].errorCount : 0)
const currentWarningCount = computed(() => files.value.length > 0 ? files.value[currentIdx.value].warningCount : 0)
const anyHasIssues = computed(() => files.value.some(f => f.issues.length > 0))

const filteredIssueItems = computed(() => {
  return currentIssues.value
    .map((issue, origIdx) => ({ issue, origIdx }))
    .filter(({ issue }) => {
      if (issueSeverityFilter.value === 'all') return true
      return issue.severity === issueSeverityFilter.value
    })
})

const shiftIssueCount = computed(() => currentIssues.value.filter(i => i.type === 'text_shift' && i.origValue !== undefined).length)
const selectedShiftCount = computed(() => {
  if (selectedIssues.value.size === 0) return 0
  return [...selectedIssues.value].filter(i => {
    const issue = currentIssues.value[i]
    return issue?.type === 'text_shift' && issue.origValue !== undefined
  }).length
})
const llmButtonEnabled = computed(() => {
  if (llmRepairing.value) return false
  if (selectedIssues.value.size > 0) return selectedShiftCount.value > 0
  return shiftIssueCount.value > 0
})
const llmButtonText = computed(() => {
  if (llmRepairing.value) return `LLM 번역 중 (${llmProgress.value})`
  if (selectedIssues.value.size > 0 && selectedShiftCount.value > 0) {
    return `선택 항목 LLM 수정 (${selectedShiftCount.value}개)`
  }
  return `줄밀림 LLM 수정 (${shiftIssueCount.value}개)`
})

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
  if (loading.value) return '<span class="summary-loading">⏳ 파일 비교 중...</span>'
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
  loading.value = true
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
  } else { loading.value = false; return }

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
  loading.value = false
  if (files.value.length > 0 && files.value[0].issues.length === 0) {
    loadPreview(files.value[0])
  } else {
    previewSamples.value = []
  }
}

function updateFilteredFiles() {
  const q = searchQuery.value.toLowerCase()
  filteredFiles.value = files.value
    .map((file, i) => ({ file, realIdx: i }))
    .filter(({ file }) => {
      if (q && !file.name.toLowerCase().includes(q)) return false
      if (filterErrors.value || filterWarnings.value) {
        const matchError = filterErrors.value && file.errorCount > 0
        const matchWarning = filterWarnings.value && file.warningCount > 0
        if (!matchError && !matchWarning) return false
      }
      return true
    })
}

function selectFile(idx: number) {
  currentIdx.value = idx
  selectedIssues.value = new Set()
  llmRepairResults.value = []
  issueSeverityFilter.value = 'all'
  const f = files.value[idx]
  if (f && f.issues.length === 0) {
    loadPreview(f)
  } else {
    previewSamples.value = []
  }
}

function toggleIssue(i: number) {
  const s = new Set(selectedIssues.value)
  if (s.has(i)) s.delete(i); else s.add(i)
  selectedIssues.value = s
}

function loadPreview(f: FileEntry) {
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    const samples: { orig: string; trans: string; path: string }[] = []
    const events = orig?.events || []
    for (let ei = 0; ei < events.length && samples.length < 10; ei++) {
      const ev = events[ei]
      if (!ev?.pages) continue
      for (let pi = 0; pi < ev.pages.length && samples.length < 10; pi++) {
        const list = ev.pages[pi]?.list || []
        const tList = trans?.events?.[ei]?.pages?.[pi]?.list || []
        for (let li = 0; li < list.length && samples.length < 10; li++) {
          const cmd = list[li]
          if (cmd?.code === 401 || cmd?.code === 405) {
            const origText = cmd.parameters?.[0]
            const transText = tList[li]?.parameters?.[0]
            if (typeof origText === 'string' && typeof transText === 'string' && origText !== transText && origText.trim()) {
              samples.push({
                orig: origText,
                trans: transText,
                path: `events[${ei}].pages[${pi}].list[${li}].parameters[0]`
              })
            }
          }
        }
      }
    }
    previewSamples.value = samples
  } catch {
    previewSamples.value = []
  }
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
        localSetAtPath(trans, issue.path, JSON.parse(JSON.stringify(origVal)))
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

function llmRepairShift() {
  const f = files.value[currentIdx.value]
  if (!f) return

  let shiftIssues: VerifyIssue[]
  if (selectedIssues.value.size > 0) {
    shiftIssues = [...selectedIssues.value]
      .map(i => f.issues[i])
      .filter(i => i?.type === 'text_shift' && i.origValue !== undefined)
  } else {
    shiftIssues = f.issues.filter(i => i.type === 'text_shift' && i.origValue !== undefined)
  }
  if (shiftIssues.length === 0) return

  llmRepairing.value = true
  llmProgress.value = `0/${shiftIssues.length}`
  llmRepairResults.value = []

  const items = shiftIssues.map(issue => ({
    path: issue.path,
    origText: String(issue.origValue)
  }))

  api.send('verifyLlmRepair', items)
}

function applyLlmRepair() {
  const f = files.value[currentIdx.value]
  if (!f || llmRepairResults.value.length === 0) return
  try {
    let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const trans = JSON.parse(transData)
    let applied = 0
    for (const item of llmRepairResults.value) {
      if (item.newText.startsWith('[번역 실패:')) continue
      if (localSetAtPath(trans, item.path, item.newText)) applied++
    }
    if (applied > 0) {
      const indent = getIndent()
      window.nodeFs.writeFileSync(f.transPath, JSON.stringify(trans, null, indent || undefined), 'utf-8')
      refreshFileIssues(currentIdx.value)
      f.repaired = true
      statusText.value = `✓ LLM 재번역 ${applied}건 적용 완료 (남은 문제: ${f.issues.length}개)`
      statusClass.value = 'status-ok'
    }
    llmRepairResults.value = []
    updateFilteredFiles()
  } catch (e) {
    statusText.value = `❌ LLM 적용 실패: ${(e as Error).message}`
    statusClass.value = 'status-error'
  }
}

onMounted(() => {
  api.on('initVerify', (dir: string) => loadFiles(dir))
  api.on('verifySettings', (s: unknown) => { (globalThis as any).settings = s })
  api.on('verifyLlmRepairProgress', (data: { current: number; total: number; path: string }) => {
    llmProgress.value = `${data.current}/${data.total}`
  })
  api.on('verifyLlmRepairDone', (data: { success: boolean; results?: { path: string; origText: string; newText: string }[]; error?: string }) => {
    llmRepairing.value = false
    if (data.success && data.results) {
      const f = files.value[currentIdx.value]
      if (!f) return
      try {
        let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
        if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
        const trans = JSON.parse(transData)
        llmRepairResults.value = data.results.map(r => ({
          ...r,
          currentText: String(window.verify.getAtPath(trans, r.path) ?? '')
        }))
      } catch {
        llmRepairResults.value = data.results.map(r => ({ ...r, currentText: '(읽기 실패)' }))
      }
      statusText.value = `✓ LLM 재번역 ${data.results.length}건 완료 — 미리보기를 확인 후 적용하세요`
      statusClass.value = 'status-ok'
    } else {
      statusText.value = `❌ LLM 재번역 실패: ${data.error}`
      statusClass.value = 'status-error'
    }
  })
  api.send('verifyReady')
})
onUnmounted(() => {
  api.removeAllListeners('initVerify')
  api.removeAllListeners('verifySettings')
  api.removeAllListeners('verifyLlmRepairProgress')
  api.removeAllListeners('verifyLlmRepairDone')
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
.no-issues-header { font-size: 14px; margin-bottom: 16px; }
.no-issues-filter { font-size: 13px; opacity: 0.4; padding: 20px; text-align: center; }
.preview-section { text-align: left; }
.preview-title { font-size: 12px; font-weight: 600; opacity: 0.7; margin-bottom: 8px; color: #8be9fd; }
.preview-item {
  padding: 8px; margin-bottom: 6px; border-radius: 6px;
  background: rgba(0,0,0,0.2); font-size: 11px;
}
.preview-path { font-size: 10px; opacity: 0.3; font-family: monospace; margin-bottom: 4px; }
.severity-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.severity-tabs button {
  padding: 4px 10px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition); opacity: 0.5;
}
.severity-tabs button:hover { opacity: 0.8; }
.severity-tabs button.active { opacity: 1; background: rgba(124,111,219,0.15); border-color: rgba(124,111,219,0.3); }
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
.value-content.new-trans { color: #50fa7b; }

.llm-preview {
  margin-bottom: 16px; padding: 10px; border-radius: 8px;
  background: rgba(80,250,123,0.04); border: 1px solid rgba(80,250,123,0.15);
}
.llm-preview-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
}
.llm-preview-title { font-size: 13px; font-weight: 700; color: #50fa7b; }
.llm-preview-actions { display: flex; gap: 4px; }
.llm-preview-actions button {
  padding: 3px 10px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition);
}
.llm-preview-actions button:hover { background: rgba(255,255,255,0.08); }
.llm-preview-item {
  padding: 8px; margin-bottom: 6px; border-radius: 6px;
  background: rgba(0,0,0,0.2); font-size: 11px;
}

:deep(.summary-error) { color: #ff5555; }
:deep(.summary-warn) { color: #f1fa8c; }
:deep(.summary-ok) { color: #50fa7b; }
:deep(.summary-total) { opacity: 0.4; }
:deep(.summary-loading) { color: #8be9fd; }
</style>
