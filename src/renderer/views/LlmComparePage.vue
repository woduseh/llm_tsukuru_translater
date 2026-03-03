<template>
  <div class="compare-layout">
    <!-- Loading overlay -->
    <div v-if="busy" class="loading-overlay">
      <div class="loading-spinner"></div>
      <div class="loading-text">{{ busyMessage }}</div>
    </div>

    <!-- Left: File list -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <input type="text" v-model="searchQuery" class="search-input" placeholder="파일 검색..." @input="updateFilteredFiles">
        <div class="filter-row">
          <label><input type="checkbox" v-model="filterMismatch" @change="updateFilteredFiles"> 불일치</label>
          <label><input type="checkbox" v-model="filterUntranslated" @change="updateFilteredFiles"> 미번역</label>
          <span class="file-count">{{ filteredFiles.length }}/{{ files.length }}</span>
        </div>
      </div>
      <div class="file-list" ref="fileListEl">
        <div v-for="item in filteredFiles" :key="item.realIdx"
          class="file-item" :class="{ active: item.realIdx === currentIdx }"
          @click="selectFile(item.realIdx)">
          <span>{{ item.file.name }}</span>
          <span v-if="dirty[item.file.name]" class="badge badge-dirty">수정됨</span>
          <span v-if="item.file.mismatch" class="badge badge-error">불일치</span>
          <span v-if="item.file.untranslated" class="badge badge-untranslated">미번역</span>
          <span v-if="!item.file.mismatch && !item.file.untranslated" class="badge badge-ok">정상</span>
        </div>
      </div>
    </aside>

    <!-- Right: Block comparison -->
    <main class="content">
      <div class="toolbar">
        <div class="summary" v-html="summaryHtml"></div>
        <div class="nav-buttons">
          <button @click="navigateFile(-1)" title="이전 문제 파일">◀ 파일</button>
          <button @click="navigateFile(1)" title="다음 문제 파일">파일 ▶</button>
          <button :disabled="!hasProblems" @click="navigateBlock(-1)" title="이전 불일치 블록">◀ 블록</button>
          <button :disabled="!hasProblems" @click="navigateBlock(1)" title="다음 불일치 블록">블록 ▶</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="action-group">
          <span class="group-label">자동 수정</span>
          <span class="selection-count">{{ selectedBlocks.size > 0 ? `${selectedBlocks.size}개 선택` : '' }}</span>
          <button :disabled="selectedBlocks.size === 0" @click="autoFixSelected"
            title="선택 블록 자동 수정: 빈줄 추가/제거, 구분자 수정">선택 블록 자동 수정</button>
          <button :disabled="files.length === 0" @click="autoFixCurrentFile"
            title="현재 파일의 모든 불일치 블록 자동 수정: 빈줄 추가/제거, 구분자 수정">파일 불일치 자동 수정</button>
          <button :disabled="files.length === 0" @click="autoFixAllMapFiles"
            title="모든 Map***.txt 파일의 불일치 블록 자동 수정 (Map 파일만 안전하게 자동 수정 가능)">전체 불일치 자동 수정</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="action-group">
          <span class="group-label">재번역</span>
          <button :disabled="selectedBlocks.size === 0 || retranslating" @click="retranslateSelected">선택 블록 재번역</button>
          <button :disabled="!hasUntranslatedBlocks || retranslating" @click="retranslateUntranslated"
            title="현재 파일의 미번역 블록만 재번역">미번역 블록 재번역</button>
          <button :disabled="files.length === 0 || retranslating" @click="retranslateFile">전체 파일 재번역</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="action-group">
          <span class="group-label">저장</span>
          <button :disabled="!isDirty" @click="saveFile">저장</button>
          <span class="save-status">{{ saveStatus }}</span>
        </div>
      </div>

      <div class="blocks-container">
        <div class="blocks-col" ref="origBlocksEl" @scroll="syncScroll('orig')">
          <div class="col-header">원문</div>
          <div v-for="(block, i) in origBlocks" :key="i"
            class="block" :class="blockClass(i)"
            :ref="el => setOrigBlockRef(i, el as HTMLElement)">
            <div class="select-indicator" @click.stop="toggleSelection(i)">
              <input type="checkbox" :checked="selectedBlocks.has(i)" tabindex="-1" @click.prevent>
            </div>
            <div v-if="block.sep" class="sep-label">{{ block.sep }}</div>
            <pre>{{ block.lines.join('\n') }}</pre>
            <div class="block-badges">
              <span v-if="untranslatedBlocks.has(i)" class="badge badge-untranslated-block">미번역</span>
              <span class="line-count">{{ block.lines.length }}줄</span>
            </div>
          </div>
        </div>
        <div class="blocks-col" ref="transBlocksEl" @scroll="syncScroll('trans')">
          <div class="col-header">번역</div>
          <div v-for="(block, i) in transBlocks" :key="i"
            class="block" :class="[blockClass(i), selectedBlocks.has(i) ? 'selected' : '']"
            :data-block-idx="i"
            :ref="el => setTransBlockRef(i, el as HTMLElement)">
            <div v-if="block.sep" class="sep-label">{{ block.sep }}</div>
            <textarea class="block-editor" :value="block.lines.join('\n')"
              :rows="Math.max(origBlocks[i]?.lines.length || block.lines.length, 1)"
              @input="onBlockEdit(i, $event)"></textarea>
            <div class="block-badges">
              <span v-if="untranslatedBlocks.has(i)" class="badge badge-untranslated-block">미번역</span>
              <span class="line-count">{{ editedTransLines[i] || block.lines.length }}줄</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { api } from '../composables/useIpc'
import { splitBlocks, checkMismatch, autoFixBlock, isBlockUntranslated } from '../compareUtils'
import type { Block } from '../compareUtils'

interface FileEntry {
  name: string; origPath: string; transPath: string;
  mismatch: boolean; untranslated: boolean;
}

const files = ref<FileEntry[]>([])
const currentIdx = ref(0)
const dirty = reactive<Record<string, boolean>>({})
const selectedBlocks = ref<Set<number>>(new Set())
const searchQuery = ref('')
const filterMismatch = ref(false)
const filterUntranslated = ref(false)
const filteredFiles = ref<{ file: FileEntry; realIdx: number }[]>([])
const origBlocks = ref<Block[]>([])
const transBlocks = ref<Block[]>([])
const editedTransLines = reactive<Record<number, number>>({})
const untranslatedBlocks = ref<Set<number>>(new Set())
const saveStatus = ref('')
const retranslating = ref(false)
const isDirty = ref(false)
const loading = ref(true)
const busy = ref(false)
const busyMessage = ref('')
let dataDir = ''

const origBlocksEl = ref<HTMLElement | null>(null)
const transBlocksEl = ref<HTMLElement | null>(null)
const origBlockRefs: Record<number, HTMLElement> = {}
const transBlockRefs: Record<number, HTMLElement> = {}

function setOrigBlockRef(i: number, el: HTMLElement | null) {
  if (el) origBlockRefs[i] = el
}
function setTransBlockRef(i: number, el: HTMLElement | null) {
  if (el) transBlockRefs[i] = el
}

const hasUntranslatedBlocks = computed(() => untranslatedBlocks.value.size > 0)

/** Whether the current file has any problem blocks (mismatch or untranslated). */
const hasProblems = computed(() => {
  for (let i = 0; i < origBlocks.value.length; i++) {
    if (blockClass(i) !== 'ok') return true
  }
  return false
})

const summaryHtml = computed(() => {
  if (loading.value) return '<span class="summary-loading">⏳ 파일 비교 중...</span>'
  if (files.value.length === 0) return '<span class="summary-error">비교할 파일이 없습니다.</span>'
  const mc = files.value.filter(f => f.mismatch).length
  const uc = files.value.filter(f => f.untranslated).length
  const parts: string[] = []
  if (mc > 0) parts.push(`<span class="summary-error">⚠ ${mc}개 줄 수 불일치</span>`)
  if (uc > 0) parts.push(`<span class="summary-warn">● ${uc}개 미번역</span>`)
  if (parts.length === 0) return `<span class="summary-ok">✓ 모든 파일 번역 완료 (${files.value.length}개)</span>`
  return parts.join(' \u00A0 ') + ` <span class="summary-total">(전체 ${files.value.length}개)</span>`
})

/** Detect untranslated status considering per-block untranslation. */
function checkFileUntranslated(origContent: string, transContent: string): boolean {
  if (origContent === transContent) return true
  const ob = splitBlocks(origContent.split('\n'))
  const tb = splitBlocks(transContent.split('\n'))
  const len = Math.min(ob.length, tb.length)
  for (let i = 0; i < len; i++) {
    if (isBlockUntranslated(ob[i], tb[i])) return true
  }
  return false
}

function loadFiles(dir: string) {
  loading.value = true
  busy.value = true
  busyMessage.value = '파일 비교 중...'
  dataDir = dir
  const wolfExtDir = window.nodePath.join(dir, '_Extract', 'Texts')
  const wolfBkDir = wolfExtDir + '_backup'
  const mvExtDir = window.nodePath.join(dir, 'Extract')
  const mvBkDir = mvExtDir + '_backup'
  let extractDir: string, backupDir: string
  if (window.nodeFs.existsSync(wolfExtDir) && window.nodeFs.existsSync(wolfBkDir)) {
    extractDir = wolfExtDir; backupDir = wolfBkDir
  } else {
    extractDir = mvExtDir; backupDir = mvBkDir
  }
  files.value = []
  if (!window.nodeFs.existsSync(extractDir) || !window.nodeFs.existsSync(backupDir)) { loading.value = false; busy.value = false; return }

  const transFiles: string[] = window.nodeFs.readdirSync(extractDir).filter((f: string) => f.endsWith('.txt'))
  for (const name of transFiles) {
    const origPath = window.nodePath.join(backupDir, name)
    const transPath = window.nodePath.join(extractDir, name)
    if (!window.nodeFs.existsSync(origPath)) continue
    const origContent = window.nodeFs.readFileSync(origPath, 'utf-8')
    const transContent = window.nodeFs.readFileSync(transPath, 'utf-8')
    const mismatch = checkMismatch(origContent.split('\n'), transContent.split('\n'))
    files.value.push({ name, origPath, transPath, mismatch, untranslated: checkFileUntranslated(origContent, transContent) })
  }
  currentIdx.value = 0
  selectedBlocks.value = new Set()
  updateFilteredFiles()
  renderBlocks()
  loading.value = false
  busy.value = false
}

function updateFilteredFiles() {
  const q = searchQuery.value.toLowerCase()
  filteredFiles.value = files.value
    .map((file, i) => ({ file, realIdx: i }))
    .filter(({ file }) => {
      if (q && !file.name.toLowerCase().includes(q)) return false
      if (filterMismatch.value && !file.mismatch) return false
      if (filterUntranslated.value && !file.untranslated) return false
      return true
    })
}

function selectFile(idx: number) {
  currentIdx.value = idx
  renderBlocks()
}

function renderBlocks() {
  if (files.value.length === 0) { origBlocks.value = []; transBlocks.value = []; return }
  const f = files.value[currentIdx.value]
  origBlocks.value = splitBlocks(window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n'))
  transBlocks.value = splitBlocks(window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n'))
  selectedBlocks.value = new Set()
  isDirty.value = false
  saveStatus.value = ''
  for (const k in editedTransLines) delete editedTransLines[k]
  updateUntranslatedBlocks()
  nextTick(syncBlockHeights)
}

function updateUntranslatedBlocks() {
  const set = new Set<number>()
  const len = Math.min(origBlocks.value.length, transBlocks.value.length)
  for (let i = 0; i < len; i++) {
    if (isBlockUntranslated(origBlocks.value[i], transBlocks.value[i])) set.add(i)
  }
  untranslatedBlocks.value = set
}

function blockClass(i: number): string {
  const ob = origBlocks.value[i], tb = transBlocks.value[i]
  if (!ob || !tb) return 'missing'
  if (ob.sep !== tb.sep) return 'error-sep'
  const tLines = editedTransLines[i] ?? tb.lines.length
  if (ob.lines.length !== tLines) return 'error-lines'
  if (untranslatedBlocks.value.has(i)) return 'untranslated'
  return 'ok'
}

function onBlockEdit(i: number, event: Event) {
  const ta = event.target as HTMLTextAreaElement
  const newLines = ta.value.split('\n')
  transBlocks.value[i].lines = newLines
  editedTransLines[i] = newLines.length
  isDirty.value = true
  dirty[files.value[currentIdx.value].name] = true
  saveStatus.value = ''
  updateUntranslatedBlocks()
}

function toggleSelection(i: number) {
  const s = new Set(selectedBlocks.value)
  if (s.has(i)) s.delete(i); else s.add(i)
  selectedBlocks.value = s
}

function autoFixSelected() {
  const fixes: string[] = []
  for (const i of selectedBlocks.value) {
    const result = autoFixBlock(origBlocks.value[i], transBlocks.value[i])
    if (result) {
      editedTransLines[i] = transBlocks.value[i].lines.length
      fixes.push(result)
    }
  }
  if (fixes.length > 0) {
    isDirty.value = true
    dirty[files.value[currentIdx.value].name] = true
    saveStatus.value = `${fixes.length}개 블록 수정됨`
    nextTick(syncBlockHeights)
  }
}

function autoFixCurrentFile() {
  let count = 0
  for (let i = 0; i < origBlocks.value.length; i++) {
    if (autoFixBlock(origBlocks.value[i], transBlocks.value[i])) {
      editedTransLines[i] = transBlocks.value[i].lines.length
      count++
    }
  }
  if (count > 0) {
    isDirty.value = true
    dirty[files.value[currentIdx.value].name] = true
    saveStatus.value = `${count}개 블록 자동 수정됨`
    nextTick(syncBlockHeights)
  }
}

/** Auto-fix + save all Map***.txt files. Other files are skipped due to higher error risk. */
function autoFixAllMapFiles() {
  const MAP_RE = /^Map\d+\.txt$/i
  busy.value = true
  busyMessage.value = '전체 Map 파일 자동 수정 중...'
  let totalFixed = 0, filesFixed = 0
  try {
    for (let fi = 0; fi < files.value.length; fi++) {
      const f = files.value[fi]
      if (!MAP_RE.test(f.name) || !f.mismatch) continue
      const ob = splitBlocks(window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n'))
      const tb = splitBlocks(window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n'))
      let count = 0
      for (let i = 0; i < ob.length; i++) {
        if (autoFixBlock(ob[i], tb[i])) count++
      }
      if (count > 0) {
        const parts: string[] = []
        for (const block of tb) { if (block.sep) parts.push(block.sep); parts.push(...block.lines) }
        window.nodeFs.writeFileSync(f.transPath, parts.join('\n'), 'utf-8')
        const origContent = window.nodeFs.readFileSync(f.origPath, 'utf-8')
        const transContent = window.nodeFs.readFileSync(f.transPath, 'utf-8')
        f.mismatch = checkMismatch(origContent.split('\n'), transContent.split('\n'))
        f.untranslated = checkFileUntranslated(origContent, transContent)
        totalFixed += count
        filesFixed++
      }
    }
    saveStatus.value = filesFixed > 0
      ? `${filesFixed}개 Map 파일, ${totalFixed}개 블록 자동 수정 완료`
      : '수정할 Map 파일이 없습니다'
    updateFilteredFiles()
    renderBlocks()
  } finally {
    busy.value = false
  }
}

/** Synchronize block heights between orig and trans columns. */
function syncBlockHeights() {
  const len = Math.min(origBlocks.value.length, transBlocks.value.length)
  for (let i = 0; i < len; i++) {
    const origEl = origBlockRefs[i]
    const transEl = transBlockRefs[i]
    if (!origEl || !transEl) continue
    // Reset to auto to get natural height
    origEl.style.minHeight = ''
    transEl.style.minHeight = ''
    const maxH = Math.max(origEl.offsetHeight, transEl.offsetHeight)
    if (origEl.offsetHeight < maxH) origEl.style.minHeight = maxH + 'px'
    if (transEl.offsetHeight < maxH) transEl.style.minHeight = maxH + 'px'
  }
}

let syncing = false
let programmaticScroll = false
function syncScroll(source: 'orig' | 'trans') {
  if (syncing || programmaticScroll) return
  syncing = true
  if (source === 'orig' && origBlocksEl.value && transBlocksEl.value) {
    transBlocksEl.value.scrollTop = origBlocksEl.value.scrollTop
  } else if (source === 'trans' && origBlocksEl.value && transBlocksEl.value) {
    origBlocksEl.value.scrollTop = transBlocksEl.value.scrollTop
  }
  syncing = false
}

function saveFile() {
  if (files.value.length === 0) return
  busy.value = true
  busyMessage.value = '저장 중...'
  try {
    const f = files.value[currentIdx.value]
    const parts: string[] = []
    for (const block of transBlocks.value) { if (block.sep) parts.push(block.sep); parts.push(...block.lines) }
    window.nodeFs.writeFileSync(f.transPath, parts.join('\n'), 'utf-8')
    const origContent = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    const transContent = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    f.mismatch = checkMismatch(origContent.split('\n'), transContent.split('\n'))
    f.untranslated = checkFileUntranslated(origContent, transContent)
    dirty[f.name] = false
    isDirty.value = false
    saveStatus.value = '저장됨 ✓'
    updateFilteredFiles()
    renderBlocks()
    // Auto-navigate to next problem file if current has no issues
    if (!f.mismatch && !f.untranslated) {
      navigateFile(1)
    }
  } finally {
    busy.value = false
  }
}

function retranslateFile() {
  if (files.value.length === 0 || !dataDir) return
  retranslating.value = true
  saveStatus.value = '🔄 준비 중...'
  api.send('retranslateFile', { dir: dataDir, fileName: files.value[currentIdx.value].name })
}

function retranslateSelected() {
  if (files.value.length === 0 || !dataDir || selectedBlocks.value.size === 0) return
  retranslating.value = true
  saveStatus.value = '🔄 준비 중...'
  const indices = Array.from(selectedBlocks.value).sort((a, b) => a - b)
  api.send('retranslateBlocks', { dir: dataDir, fileName: files.value[currentIdx.value].name, blockIndices: indices })
}

function retranslateUntranslated() {
  if (files.value.length === 0 || !dataDir || untranslatedBlocks.value.size === 0) return
  retranslating.value = true
  saveStatus.value = '🔄 준비 중...'
  const indices = Array.from(untranslatedBlocks.value).sort((a, b) => a - b)
  api.send('retranslateBlocks', { dir: dataDir, fileName: files.value[currentIdx.value].name, blockIndices: indices })
}

function navigateFile(dir: 1 | -1) {
  if (files.value.length === 0) return
  const start = currentIdx.value + dir
  for (let i = 0; i < files.value.length; i++) {
    const idx = ((start + dir * i) % files.value.length + files.value.length) % files.value.length
    if (files.value[idx].mismatch || files.value[idx].untranslated) {
      currentIdx.value = idx; updateFilteredFiles(); renderBlocks(); return
    }
  }
}

function navigateBlock(dir: 1 | -1) {
  if (!origBlocksEl.value || !transBlocksEl.value) return
  const problemIdx: number[] = []
  for (let i = 0; i < origBlocks.value.length; i++) {
    const cls = blockClass(i)
    if (cls !== 'ok') problemIdx.push(i)
  }
  if (problemIdx.length === 0) return

  const currentSelected = selectedBlocks.value.size > 0 ? Math.min(...selectedBlocks.value) : -1
  let target = -1
  if (dir === 1) {
    target = problemIdx.find(i => i > currentSelected) ?? problemIdx[0]
  } else {
    for (let j = problemIdx.length - 1; j >= 0; j--) {
      if (problemIdx[j] < currentSelected) { target = problemIdx[j]; break }
    }
    if (target === -1) target = problemIdx[problemIdx.length - 1]
  }
  if (target < 0) return

  selectedBlocks.value = new Set([target])

  nextTick(() => {
    programmaticScroll = true
    const origBlock = origBlocksEl.value?.querySelectorAll('.block')[target] as HTMLElement | undefined
    const transBlock = transBlocksEl.value?.querySelectorAll('.block')[target] as HTMLElement | undefined
    origBlock?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    transBlock?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => { programmaticScroll = false }, 500)
  })
}

function onRetranslateResult(result: { success: boolean; error?: string }) {
  retranslating.value = false
  if (result.success) {
    saveStatus.value = '재번역 완료 ✓'
    const f = files.value[currentIdx.value]
    const origContent = window.nodeFs.readFileSync(f.origPath, 'utf-8')
    const transContent = window.nodeFs.readFileSync(f.transPath, 'utf-8')
    f.mismatch = checkMismatch(origContent.split('\n'), transContent.split('\n'))
    f.untranslated = checkFileUntranslated(origContent, transContent)
    updateFilteredFiles(); renderBlocks()
  } else { saveStatus.value = `❌ ${result.error || '번역 실패'}` }
}

onMounted(() => {
  api.on('initCompare', (dir: string) => loadFiles(dir))
  api.on('retranslateProgress', (msg: string) => { saveStatus.value = `🔄 ${msg}` })
  api.on('retranslateFileDone', onRetranslateResult)
  api.on('retranslateBlocksDone', onRetranslateResult)

  document.addEventListener('keydown', onKeydown)
  api.send('compareReady')
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  for (const ch of ['initCompare', 'retranslateProgress', 'retranslateFileDone', 'retranslateBlocksDone']) {
    api.removeAllListeners(ch)
  }
})

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile() }
}
</script>

<style scoped>
.compare-layout { display: flex; height: 100vh; position: relative; }

/* Loading overlay */
.loading-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5); z-index: 100;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
}
.loading-spinner {
  width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.15);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: var(--mainColor); opacity: 0.8; }

.sidebar { width: 240px; border-right: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; }
.sidebar-header { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.search-input {
  width: 100%; padding: 6px 8px; background: var(--Highlight1); border: var(--border);
  border-radius: 6px; color: var(--mainColor); font-size: 12px; font-family: inherit; margin-bottom: 6px;
}
.filter-row { display: flex; gap: 10px; align-items: center; font-size: 11px; opacity: 0.6; }
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
.badge-dirty { background: rgba(241,250,140,0.2); color: #f1fa8c; }
.badge-untranslated { background: rgba(139,233,253,0.15); color: #8be9fd; }
.badge-ok { background: rgba(80,250,123,0.15); color: #50fa7b; }

.content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.toolbar {
  padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; overflow-x: auto;
  flex-shrink: 0;
}
.summary { font-size: 12px; white-space: nowrap; }
.toolbar-separator { width: 1px; height: 20px; background: rgba(255,255,255,0.1); flex-shrink: 0; }
.nav-buttons { display: flex; gap: 3px; align-items: center; flex-shrink: 0; }
.action-group { display: flex; gap: 3px; align-items: center; flex-shrink: 0; }
.group-label { font-size: 9px; opacity: 0.35; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.nav-buttons button, .action-group button {
  padding: 3px 8px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition); white-space: nowrap;
}
.nav-buttons button:hover, .action-group button:hover { background: rgba(255,255,255,0.08); }
.nav-buttons button:disabled, .action-group button:disabled { opacity: 0.3; cursor: default; }
.selection-count { font-size: 10px; opacity: 0.5; white-space: nowrap; }
.save-status { font-size: 11px; opacity: 0.6; white-space: nowrap; }

.blocks-container { flex: 1; display: flex; overflow: hidden; }
.blocks-col { flex: 1; overflow-y: auto; padding: 8px; }
.col-header {
  font-size: 11px; font-weight: 700; opacity: 0.4; padding: 4px 8px 6px;
  position: sticky; top: 0; background: var(--background); z-index: 2;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  margin-bottom: 4px;
}
.block {
  margin-bottom: 4px; padding: 8px 10px; border-radius: 6px; position: relative;
  background: var(--Highlight1); border: 1px solid transparent; font-size: 12px;
  box-sizing: border-box;
}
.blocks-col:first-child .block { padding-left: 40px; }
.block.ok { border-color: rgba(80,250,123,0.1); }
.block.error-lines, .block.error-sep { border-color: rgba(255,85,85,0.3); background: rgba(255,85,85,0.05); }
.block.missing { border-color: rgba(255,184,108,0.3); background: rgba(255,184,108,0.05); }
.block.untranslated { border-color: rgba(139,233,253,0.25); background: rgba(139,233,253,0.04); }
.block.selected { border-color: rgba(124,111,219,0.5); background: rgba(124,111,219,0.08); }
.select-indicator {
  position: absolute; top: 0; left: 0; width: 32px; height: 100%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0.4; transition: var(--transition);
  background: rgba(255,255,255,0.02); border-right: 1px solid rgba(255,255,255,0.04);
}
.select-indicator:hover { opacity: 1; background: rgba(124,111,219,0.15); }
.select-indicator input[type="checkbox"] {
  width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent);
}
.sep-label { font-size: 10px; opacity: 0.3; margin-bottom: 4px; }
.block-badges { position: absolute; bottom: 4px; right: 8px; display: flex; gap: 6px; align-items: center; }
.badge-untranslated-block { font-size: 8px; padding: 1px 4px; border-radius: 3px; background: rgba(139,233,253,0.15); color: #8be9fd; }
.line-count { font-size: 9px; opacity: 0.3; }
pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; font-family: inherit; }
.block-editor {
  width: 100%; background: transparent; border: none; color: var(--mainColor);
  font-size: 12px; font-family: inherit; resize: none; outline: none;
}
:deep(.summary-error) { color: #ff5555; }
:deep(.summary-warn) { color: #f1fa8c; }
:deep(.summary-ok) { color: #50fa7b; }
:deep(.summary-total) { opacity: 0.4; }
:deep(.summary-loading) { color: #8be9fd; }
</style>
