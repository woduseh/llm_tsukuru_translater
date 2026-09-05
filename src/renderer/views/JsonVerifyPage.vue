<template>
  <div
    class="verify-layout"
    data-harness-view="json-verify"
    :data-file-count="files.length"
    :data-total-issues="totalIssueCount"
    :data-error-files="errorFileCount"
    :data-warning-files="warningFileCount"
  >
    <!-- Left: File list -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="panel-title">구조 검수</div>
        <input type="text" v-model="searchQuery" class="search-input" placeholder="파일 검색..." aria-label="구조 검수 파일 검색">
        <div class="filter-row">
          <label><input type="checkbox" v-model="filterErrors"> 오류</label>
          <label><input type="checkbox" v-model="filterWarnings"> 경고</label>
          <span class="file-count">{{ filteredFiles.length }}/{{ files.length }}</span>
        </div>
      </div>
      <div class="file-list">
        <button v-for="item in filteredFiles" :key="item.realIdx" type="button"
          class="file-item" :class="{ active: item.realIdx === currentIdx }"
          :disabled="llmRepairing || verifyWriting"
          @click="selectFile(item.realIdx)">
          <span>{{ item.file.name }}</span>
          <span v-if="item.file.repaired" class="badge badge-repaired">수정됨</span>
          <span v-if="item.file.errorCount > 0" class="badge badge-error">❌ {{ item.file.errorCount }}</span>
          <span v-if="item.file.warningCount > 0" class="badge badge-warn">⚠ {{ item.file.warningCount }}</span>
          <span v-if="item.file.issues.length === 0" class="badge badge-ok">✓</span>
        </button>
      </div>
    </aside>

    <!-- Right: Issues -->
    <main class="content">
      <div class="toolbar">
        <div class="summary">
          <span v-for="(item, index) in summaryItems" :key="`${item.class}-${index}`" :class="item.class">{{ item.text }}</span>
        </div>
        <div class="action-buttons">
          <button data-harness-shift-repair :disabled="!llmButtonEnabled" @click="llmRepairShift" :title="llmRepairTitle">
            {{ llmButtonText }}
          </button>
          <button :disabled="verifyWriting" @click="close">닫기</button>
        </div>
        <div v-if="selectedIssues.size > 0" class="action-buttons selection-toolbar">
          <span class="selection-count">{{ selectedIssues.size }}개 선택</span>
          <button :disabled="verifyWriting" @click="revertSelected" title="선택한 항목을 원본 값으로 되돌립니다">선택 되돌리기</button>
          <button :disabled="verifyWriting" @click="selectedIssues.clear()">선택 해제</button>
        </div>
        <details class="batch-actions">
          <summary>파일 단위 자동 수정</summary>
          <p>원본 구조를 기준으로 수정해요. 번역 값이 원본으로 되돌아갈 수 있어요.</p>
          <div class="action-buttons">
            <button :disabled="!currentHasIssues || verifyWriting" @click="repairCurrentFile">현재 파일 수정</button>
            <button :disabled="!anyHasIssues || verifyWriting" @click="repairAll">전체 수정</button>
          </div>
        </details>
        <div class="status" :class="statusClass" role="status">{{ statusText }}</div>
      </div>

      <div class="issues-panel">
        <div class="issues-file-name">{{ currentFileName }}</div>

        <!-- 심각도 필터 탭 -->
        <div v-if="currentIssues.length > 0" class="severity-tabs">
          <button :class="{ active: issueSeverityFilter === 'all' }" :aria-pressed="issueSeverityFilter === 'all'" @click="issueSeverityFilter = 'all'">
            전체 ({{ currentIssues.length }})
          </button>
          <button :class="{ active: issueSeverityFilter === 'error' }" :aria-pressed="issueSeverityFilter === 'error'" @click="issueSeverityFilter = 'error'">
            ❌ 오류 ({{ currentErrorCount }})
          </button>
          <button :class="{ active: issueSeverityFilter === 'warning' }" :aria-pressed="issueSeverityFilter === 'warning'" @click="issueSeverityFilter = 'warning'">
            ⚠ 경고 ({{ currentWarningCount }})
          </button>
        </div>

        <!-- LLM 재번역 미리보기 -->
        <div v-if="llmRepairResults.length > 0" class="llm-preview">
          <div class="llm-preview-header">
            <span class="llm-preview-title">🔄 LLM 재번역 미리보기 ({{ llmRepairResults.length }}건)</span>
            <div class="llm-preview-actions">
              <button :disabled="verifyWriting" @click="applyLlmRepair">전체 적용</button>
              <button @click="cancelLlmRepair">취소</button>
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

        <div v-if="loading" class="no-issues-filter" role="status">파일 구조를 검사하고 있어요…</div>
        <div v-else-if="currentIssues.length === 0 && llmRepairResults.length === 0" class="no-issues">
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
          <label class="issue-checkbox">
            <input type="checkbox" :checked="selectedIssues.has(item.origIdx)" :aria-label="`${typeLabel(item.issue.type)}: ${item.issue.path} 선택`" :disabled="verifyWriting || llmRepairing" @change="toggleIssue(item.origIdx)">
          </label>
          <div class="issue-content">
            <div class="issue-header">
              <div class="issue-type">{{ typeLabel(item.issue.type) }}</div>
              <span class="issue-severity">{{ item.issue.severity === 'error' ? '오류' : '경고' }}</span>
            </div>
            <div class="issue-message">{{ item.issue.message }}</div>
            <details class="issue-location">
              <summary>JSON 위치 보기</summary>
              <code class="issue-path">{{ item.issue.path }}</code>
            </details>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api, useIpcOn } from '../composables/useIpc'
import { getRendererLlmProviderUiText } from '../../types/llmProviderContract'
import { setAtPath } from '../../ts/rpgmv/verify'

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
const statusText = ref('')
const statusClass = ref('')
const selectedIssues = ref<Set<number>>(new Set())
const llmRepairing = ref(false)
const verifyWriting = ref(false)
const llmProgress = ref('')
const llmRepairResults = ref<{ path: string; origText: string; currentText: string; newText: string }[]>([])
const llmRepairContext = ref<{
  requestId: string
  transPath: string
  fileName: string
  preimage: string
} | null>(null)
const loading = ref(true)
const issueSeverityFilter = ref<'all' | 'error' | 'warning'>('all')
const previewSamples = ref<{ orig: string; trans: string; path: string }[]>([])
const jsonChangeLine = ref(false)
const llmReady = ref(false)
const currentProvider = ref('gemini')

interface VerifyApplyJsonResult {
  requestId: string
  fileName: string
  targetPath: string
  success: boolean
  error?: string
}

interface PendingVerifyWrite {
  fileName: string
  targetPath: string
  resolve: (result: VerifyApplyJsonResult) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const pendingVerifyWrites = new Map<string, PendingVerifyWrite>()

function requestAtomicJsonWrite(
  file: FileEntry,
  expectedContent: string,
  nextContent: string,
): Promise<VerifyApplyJsonResult> {
  const requestId = globalThis.crypto?.randomUUID?.() ?? `verify-write-${Date.now()}-${Math.random()}`
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingVerifyWrites.delete(requestId)
      resolve({
        requestId,
        fileName: file.name,
        targetPath: file.transPath,
        success: false,
        error: 'JSON Verify 저장 응답 시간을 초과했습니다.',
      })
    }, 30_000)
    pendingVerifyWrites.set(requestId, {
      fileName: file.name,
      targetPath: file.transPath,
      resolve,
      timeoutId,
    })
    api.send('verifyApplyJson', {
      requestId,
      fileName: file.name,
      targetPath: file.transPath,
      expectedContent,
      nextContent,
    })
  })
}

function onVerifyApplyJsonDone(result: VerifyApplyJsonResult) {
  const pending = pendingVerifyWrites.get(result.requestId)
  if (!pending
    || pending.fileName !== result.fileName
    || pending.targetPath !== result.targetPath) return
  clearTimeout(pending.timeoutId)
  pendingVerifyWrites.delete(result.requestId)
  pending.resolve(result)
}

const currentFileName = computed(() => files.value.length > 0 ? files.value[currentIdx.value].name : '')
const currentIssues = computed(() => files.value.length > 0 ? files.value[currentIdx.value].issues : [])
const currentHasIssues = computed(() => files.value.length > 0 && files.value[currentIdx.value].issues.length > 0)
const currentErrorCount = computed(() => files.value.length > 0 ? files.value[currentIdx.value].errorCount : 0)
const currentWarningCount = computed(() => files.value.length > 0 ? files.value[currentIdx.value].warningCount : 0)
const anyHasIssues = computed(() => files.value.some(f => f.issues.length > 0))
const totalIssueCount = computed(() => files.value.reduce((sum, file) => sum + file.issues.length, 0))
const errorFileCount = computed(() => files.value.filter(file => file.errorCount > 0).length)
const warningFileCount = computed(() => files.value.filter(file => file.warningCount > 0 && file.errorCount === 0).length)

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
  if (!llmReady.value) return false
  if (llmRepairing.value || verifyWriting.value) return false
  if (selectedIssues.value.size > 0) return selectedShiftCount.value > 0
  return shiftIssueCount.value > 0
})
const llmRepairTitle = computed(() => (
  llmReady.value
    ? '줄밀림 위치의 원본 텍스트를 LLM으로 재번역합니다'
    : getRendererLlmProviderUiText(currentProvider.value).missingConfigMessage
))
const llmButtonText = computed(() => {
  if (!llmReady.value) return currentProvider.value === 'vertex' ? 'Vertex 설정 필요' : 'Gemini 설정 필요'
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

interface SummaryItem {
  class: string
  text: string
}

const summaryItems = computed<SummaryItem[]>(() => {
  if (loading.value) return [{ class: 'summary-loading', text: '⏳ 파일 비교 중...' }]
  if (files.value.length === 0) return [{ class: 'summary-error', text: '비교할 파일이 없습니다.' }]
  const ef = errorFileCount.value
  const wf = warningFileCount.value
  const total = totalIssueCount.value
  if (total === 0) return [{ class: 'summary-ok', text: `✓ 모든 파일의 JSON 구조가 일치합니다 (${files.value.length}개)` }]
  const parts: SummaryItem[] = []
  if (ef > 0) parts.push({ class: 'summary-error', text: `❌ ${ef}개 파일에서 구조 오류` })
  if (wf > 0) parts.push({ class: 'summary-warn', text: `⚠ ${wf}개 파일에서 경고` })
  parts.push({ class: 'summary-total', text: `(전체 ${files.value.length}개, ${total}개 문제)` })
  return parts
})

function loadFiles(dir: string) {
  loading.value = true
  llmRepairing.value = false
  llmRepairResults.value = []
  llmRepairContext.value = null
  files.value = []
  currentIdx.value = 0
  selectedIssues.value = new Set()

  try {
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
        const issues = window.verify.verifyJsonIntegrity(orig, trans) as VerifyIssue[]
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
    if (files.value.length > 0 && files.value[0].issues.length === 0) {
      loadPreview(files.value[0])
    } else {
      previewSamples.value = []
    }
  } catch (error) {
    statusText.value = `❌ 파일을 불러오지 못했습니다: ${(error as Error).message}`
    statusClass.value = 'status-error'
  } finally {
    loading.value = false
  }
}

const filteredFiles = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return files.value
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
})

function selectFile(idx: number) {
  if (llmRepairing.value || verifyWriting.value) return
  currentIdx.value = idx
  selectedIssues.value = new Set()
  llmRepairResults.value = []
  llmRepairContext.value = null
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
  return 4 * Number(jsonChangeLine.value)
}

function refreshFileIssues(idx: number) {
  const f = files.value[idx]
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    let transData = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    const issues = window.verify.verifyJsonIntegrity(orig, trans) as VerifyIssue[]
    f.issues = issues
    f.errorCount = issues.filter(i => i.severity === 'error').length
    f.warningCount = issues.filter(i => i.severity === 'warning').length
  } catch (e) {
    f.issues = [{ path: '$', type: 'parse_error', severity: 'error', message: `JSON 파싱 오류: ${(e as Error).message}` }]
    f.errorCount = 1; f.warningCount = 0
  }
}

async function revertSelected() {
  const f = files.value[currentIdx.value]
  if (!f || selectedIssues.value.size === 0) return
  verifyWriting.value = true
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    const expectedContent = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    let transData = expectedContent
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    let reverted = 0
    for (const idx of selectedIssues.value) {
      const issue = f.issues[idx]
      if (!issue || issue.path === '$') continue
      const origVal = window.verify.getAtPath(orig, issue.path)
      if (origVal !== undefined) {
        setAtPath(trans, issue.path, JSON.parse(JSON.stringify(origVal)))
        reverted++
      }
    }
    if (reverted > 0) {
      const indent = getIndent()
      const result = await requestAtomicJsonWrite(
        f,
        expectedContent,
        JSON.stringify(trans, null, indent || undefined),
      )
      if (!result.success) throw new Error(result.error || 'JSON 저장에 실패했습니다.')
      refreshFileIssues(currentIdx.value)
      f.repaired = true
      statusText.value = `✓ ${reverted}개 항목 되돌리기 완료 (남은 문제: ${f.issues.length}개)`
      statusClass.value = 'status-ok'
    } else {
      statusText.value = '되돌릴 수 있는 항목이 없습니다'
      statusClass.value = 'status-error'
    }
    selectedIssues.value = new Set()
  } catch (e) {
    statusText.value = `❌ 되돌리기 실패: ${(e as Error).message}`
    statusClass.value = 'status-error'
  } finally {
    verifyWriting.value = false
  }
}

async function repairFile(idx: number): Promise<{ success: boolean; fixed: number; remaining: number; error?: string }> {
  const f = files.value[idx]
  if (f.issues.length === 0) return { success: false, fixed: 0, remaining: 0, error: '문제가 없는 파일' }
  try {
    let origData = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    const expectedContent = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    let transData = expectedContent
    if (origData.charCodeAt(0) === 0xFEFF) origData = origData.substring(1)
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const orig = JSON.parse(origData), trans = JSON.parse(transData)
    const beforeCount = f.issues.length
    const repaired = window.verify.repairJson(orig, trans)
    const indent = getIndent()
    const output = JSON.stringify(repaired, null, indent || undefined)
    const writeResult = await requestAtomicJsonWrite(f, expectedContent, output)
    if (!writeResult.success) throw new Error(writeResult.error || 'JSON 저장에 실패했습니다.')
    refreshFileIssues(idx)
    f.repaired = true
    const fixed = beforeCount - f.issues.length
    return { success: true, fixed, remaining: f.issues.length }
  } catch (e) { return { success: false, fixed: 0, remaining: f.issues.length, error: (e as Error).message } }
}

async function repairCurrentFile() {
  verifyWriting.value = true
  try {
    const result = await repairFile(currentIdx.value)
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
  } finally {
    verifyWriting.value = false
  }
}

async function repairAll() {
  verifyWriting.value = true
  let repaired = 0, failed = 0, totalFixed = 0, totalRemaining = 0
  try {
    for (let i = 0; i < files.value.length; i++) {
      if (files.value[i].issues.length > 0) {
        const r = await repairFile(i)
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
  } finally {
    verifyWriting.value = false
  }
}

function close() { window.close() }

function llmRepairShift() {
  const f = files.value[currentIdx.value]
  if (!f) return
  if (!llmReady.value) {
    statusText.value = `❌ ${getRendererLlmProviderUiText(currentProvider.value).missingConfigMessage}`
    statusClass.value = 'status-error'
    return
  }

  let shiftIssues: VerifyIssue[]
  if (selectedIssues.value.size > 0) {
    shiftIssues = [...selectedIssues.value]
      .map(i => f.issues[i])
      .filter(i => i?.type === 'text_shift' && i.origValue !== undefined)
  } else {
    shiftIssues = f.issues.filter(i => i.type === 'text_shift' && i.origValue !== undefined)
  }
  if (shiftIssues.length === 0) return

  let preimage: string
  try {
    preimage = window.nodeFs.readFileSync(f.transPath, 'utf-8')
  } catch (e) {
    statusText.value = `❌ 대상 파일을 읽지 못했습니다: ${(e as Error).message}`
    statusClass.value = 'status-error'
    return
  }

  const requestId = `verify-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`
  llmRepairing.value = true
  llmProgress.value = `0/${shiftIssues.length}`
  llmRepairResults.value = []
  llmRepairContext.value = {
    requestId,
    transPath: f.transPath,
    fileName: f.name,
    preimage,
  }

  const items = shiftIssues.map(issue => ({
    path: issue.path,
    origText: String(issue.origValue)
  }))

  api.send('verifyLlmRepair', { requestId, items })
}

async function applyLlmRepair() {
  const repairContext = llmRepairContext.value
  if (!repairContext || llmRepairResults.value.length === 0) return
  const targetIdx = files.value.findIndex(file => file.transPath === repairContext.transPath && file.name === repairContext.fileName)
  const f = files.value[targetIdx]
  if (!f) {
    statusText.value = '❌ 복구 요청의 대상 파일을 더 이상 찾을 수 없습니다.'
    statusClass.value = 'status-error'
    cancelLlmRepair()
    return
  }
  verifyWriting.value = true
  try {
    const currentPreimage = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    if (currentPreimage !== repairContext.preimage) {
      throw new Error('요청 이후 대상 파일이 변경되어 결과를 적용하지 않았습니다.')
    }
    let transData = currentPreimage
    if (transData.charCodeAt(0) === 0xFEFF) transData = transData.substring(1)
    const trans = JSON.parse(transData)
    let applied = 0
    for (const item of llmRepairResults.value) {
      if (item.newText.startsWith('[번역 실패:')) continue
      if (setAtPath(trans, item.path, item.newText)) applied++
    }
    if (applied > 0) {
      const indent = getIndent()
      const result = await requestAtomicJsonWrite(
        f,
        repairContext.preimage,
        JSON.stringify(trans, null, indent || undefined),
      )
      if (!result.success) throw new Error(result.error || 'JSON 저장에 실패했습니다.')
      refreshFileIssues(targetIdx)
      f.repaired = true
      statusText.value = `✓ LLM 재번역 ${applied}건 적용 완료 (남은 문제: ${f.issues.length}개)`
      statusClass.value = 'status-ok'
    }
    llmRepairResults.value = []
    llmRepairContext.value = null
  } catch (e) {
    statusText.value = `❌ LLM 적용 실패: ${(e as Error).message}`
    statusClass.value = 'status-error'
  } finally {
    verifyWriting.value = false
  }
}

function cancelLlmRepair() {
  llmRepairResults.value = []
  llmRepairContext.value = null
}

onMounted(() => {
  useIpcOn('initVerify', (dir: string) => loadFiles(dir))
  useIpcOn('verifyApplyJsonDone', onVerifyApplyJsonDone)
  useIpcOn('verifySettings', (s: unknown) => {
    const settings = s as Record<string, any>
    jsonChangeLine.value = !!settings.JsonChangeLine
    llmReady.value = !!settings.llmReady
    currentProvider.value = typeof settings.llmProvider === 'string' ? settings.llmProvider : 'gemini'
  })
  useIpcOn('verifyLlmRepairProgress', (data: { requestId: string; current: number; total: number; path: string }) => {
    if (data.requestId !== llmRepairContext.value?.requestId) return
    llmProgress.value = `${data.current}/${data.total}`
  })
  useIpcOn('verifyLlmRepairDone', (data: { requestId: string; success: boolean; results?: { path: string; origText: string; newText: string }[]; error?: string }) => {
    const repairContext = llmRepairContext.value
    if (!repairContext || data.requestId !== repairContext.requestId) return
    llmRepairing.value = false
    if (data.success && data.results) {
      const f = files.value.find(file => file.transPath === repairContext.transPath && file.name === repairContext.fileName)
      if (!f) {
        statusText.value = '❌ 복구 요청의 대상 파일을 더 이상 찾을 수 없습니다.'
        statusClass.value = 'status-error'
        cancelLlmRepair()
        return
      }
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
      llmRepairContext.value = null
    }
  })
  api.send('verifyReady')
})
onUnmounted(() => {
  for (const pending of pendingVerifyWrites.values()) clearTimeout(pending.timeoutId)
  pendingVerifyWrites.clear()
})
</script>

<style scoped>
.verify-layout { display: flex; height: 100vh; }
.sidebar { width: 240px; flex-shrink: 0; border-right: var(--border); background: #0c1216; display: flex; flex-direction: column; }
.panel-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.sidebar-header { padding: 12px; border-bottom: var(--border); }
.search-input {
  width: 100%; padding: 6px 8px; background: var(--Highlight1); border: var(--border);
  border-radius: 6px; color: var(--mainColor); font-size: 12px; font-family: inherit; margin-bottom: 6px;
}
.filter-row { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.file-count { margin-left: auto; }
.file-list { flex: 1; overflow-y: auto; }
.file-item {
  width: 100%; padding: 9px 10px; cursor: pointer; font-size: 12px;
  display: flex; align-items: center; gap: 6px; transition: var(--transition);
  border: 0; border-bottom: var(--border); background: transparent; color: var(--mainColor); text-align: left;
}
.file-item:hover { background: #151f24; }
.file-item.active { background: #20231d; border-left: 3px solid var(--Accent); }
.badge { font-size: 9px; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
.badge-error { background: rgba(255,85,85,0.2); color: #ff5555; }
.badge-warn { background: rgba(255,184,108,0.2); color: #ffb86c; }
.badge-ok { background: rgba(80,250,123,0.2); color: #50fa7b; }
.badge-repaired { background: rgba(241,250,140,0.2); color: #f1fa8c; }

.content { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.toolbar {
  padding: 12px 16px; border-bottom: var(--border); background: #10171b; flex-shrink: 0;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
.action-buttons { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.action-buttons button {
  padding: 7px 10px; font-size: 12px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition);
}
.action-buttons button:hover { background: rgba(255,255,255,0.08); }
.action-buttons button:disabled { opacity: 0.3; cursor: default; }
.selection-count { font-size: 12px; color: var(--muted); }
.selection-toolbar { flex-basis: 100%; padding: 8px; border-radius: 6px; background: rgba(255,176,32,.08); }
.batch-actions { flex-basis: 100%; }
.batch-actions summary, .issue-location summary { cursor: pointer; color: var(--muted); font-size: 12px; width: fit-content; padding: 4px 0; }
.batch-actions p { font-size: 12px; color: var(--muted); margin: 4px 0 10px; }
.status { font-size: 11px; margin-left: auto; }
.status-ok { color: #50fa7b; }
.status-error { color: #ff5555; }

.issues-panel { flex: 1; overflow-y: auto; padding: 12px; }
.issues-file-name { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.no-issues { font-size: 13px; color: #50fa7b; padding: 20px; text-align: center; }
.no-issues-header { font-size: 14px; margin-bottom: 16px; }
.no-issues-filter { font-size: 13px; color: var(--muted); padding: 20px; text-align: center; }
.preview-section { text-align: left; }
.preview-title { font-size: 12px; font-weight: 600; opacity: 0.7; margin-bottom: 8px; color: #8be9fd; }
.preview-item {
  padding: 8px; margin-bottom: 6px; border-radius: 6px;
  background: rgba(0,0,0,0.2); font-size: 11px;
}
.preview-path { font-size: 11px; color: var(--muted); font-family: monospace; margin-bottom: 4px; overflow-wrap: anywhere; }
.severity-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.severity-tabs button {
  padding: 4px 10px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition);
}
.severity-tabs button:hover { opacity: 0.8; }
.severity-tabs button.active { opacity: 1; background: rgba(255,176,32,.12); border-color: rgba(255,176,32,.35); }
.issue-item {
  margin-bottom: 12px; padding: 16px 16px 16px 48px; border-radius: 8px;
  background: var(--Highlight1); border-left: 3px solid transparent;
  position: relative; transition: var(--transition);
}
.issue-item.error { border-left-color: #ff5555; }
.issue-item.warning { border-left-color: #ffb86c; }
.issue-item.selected { background: rgba(255,176,32,.07); border-color: rgba(255,176,32,.55); }
.issue-checkbox {
  position: absolute; top: 0; left: 0; width: 36px; height: 100%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: var(--transition);
}
.issue-checkbox:hover { opacity: 1; background: rgba(255,176,32,.12); border-radius: 6px 0 0 6px; }
.issue-checkbox input[type="checkbox"] {
  width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent);
}
.issue-item.selected .issue-checkbox { opacity: 1; }
.issue-content { flex: 1; }
.issue-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.issue-path { font-size: 12px; color: var(--muted); font-family: monospace; overflow-wrap: anywhere; }
.issue-type { font-size: 14px; font-weight: 600; }
.issue-severity { font-size: 11px; border: 1px solid currentColor; padding: 1px 6px; border-radius: 4px; }
.error .issue-severity { color: #ffb1a8; }
.warning .issue-severity { color: #ffcf8a; }
.issue-message { font-size: 13px; line-height: 1.6; color: var(--mainColor); }
.issue-location { margin-top: 4px; }
.issue-values { margin-top: 12px; font-size: 12px; }
.value-row { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 2px; }
.value-label { font-weight: 600; color: var(--muted); min-width: 44px; padding-top: 6px; }
.value-content {
  background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 4px;
  font-family: monospace; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap;
  max-height: 180px; overflow-y: auto; display: block; flex: 1; min-width: 0;
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
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.issue-checkbox:focus-within { background: rgba(255,176,32,.12); }
@media (max-width: 900px) { .sidebar { width: 190px; } }
</style>
