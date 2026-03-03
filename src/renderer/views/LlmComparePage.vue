<template>
  <div class="compare-layout">
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
          <button @click="navigateBlock(-1)" title="이전 불일치 블록">◀ 블록</button>
          <button @click="navigateBlock(1)" title="다음 불일치 블록">블록 ▶</button>
        </div>
        <div class="action-buttons">
          <span class="selection-count">{{ selectedBlocks.size > 0 ? `${selectedBlocks.size}개 블록 선택` : '' }}</span>
          <button :disabled="selectedBlocks.size === 0 || retranslating" @click="retranslateSelected">선택 블록 재번역</button>
          <button :disabled="files.length === 0 || retranslating" @click="retranslateFile">전체 재번역</button>
          <button :disabled="!isDirty" @click="saveFile">저장</button>
          <span class="save-status">{{ saveStatus }}</span>
        </div>
      </div>

      <div class="blocks-container">
        <div class="blocks-col" ref="origBlocksEl" @scroll="syncScroll('orig')">
          <div class="col-header">원문</div>
          <div v-for="(block, i) in origBlocks" :key="i"
            class="block" :class="blockStatus(i)"
            :ref="el => setOrigBlockRef(i, el as HTMLElement)">
            <label class="select-indicator" @click.stop="toggleSelection(i)">
              <input type="checkbox" :checked="selectedBlocks.has(i)" tabindex="-1" @click.prevent>
            </label>
            <div v-if="block.sep" class="sep-label">{{ block.sep }}</div>
            <pre>{{ block.lines.join('\n') }}</pre>
            <span class="line-count">{{ block.lines.length }}줄</span>
          </div>
        </div>
        <div class="blocks-col" ref="transBlocksEl" @scroll="syncScroll('trans')">
          <div class="col-header">번역</div>
          <div v-for="(block, i) in transBlocks" :key="i"
            class="block" :class="[blockStatus(i), selectedBlocks.has(i) ? 'selected' : '']"
            :data-block-idx="i">
            <div v-if="block.sep" class="sep-label">{{ block.sep }}</div>
            <textarea class="block-editor" :value="block.lines.join('\n')"
              :rows="Math.max(origBlocks[i]?.lines.length || block.lines.length, 1)"
              @input="onBlockEdit(i, $event)"></textarea>
            <span class="line-count">{{ editedTransLines[i] || block.lines.length }}줄</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { api } from '../composables/useIpc'

const SEP_RE = /^---\s*\d+\s*---$/

interface FileEntry {
  name: string; origPath: string; transPath: string;
  mismatch: boolean; untranslated: boolean;
}
interface Block { sep: string; lines: string[] }

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
const saveStatus = ref('')
const retranslating = ref(false)
const isDirty = ref(false)
let dataDir = ''

const origBlocksEl = ref<HTMLElement | null>(null)
const transBlocksEl = ref<HTMLElement | null>(null)
const origBlockRefs: Record<number, HTMLElement> = {}

function setOrigBlockRef(i: number, el: HTMLElement | null) {
  if (el) origBlockRefs[i] = el
}

const summaryHtml = computed(() => {
  if (files.value.length === 0) return '<span class="summary-error">비교할 파일이 없습니다.</span>'
  const mc = files.value.filter(f => f.mismatch).length
  const uc = files.value.filter(f => f.untranslated).length
  const parts: string[] = []
  if (mc > 0) parts.push(`<span class="summary-error">⚠ ${mc}개 줄 수 불일치</span>`)
  if (uc > 0) parts.push(`<span class="summary-warn">● ${uc}개 미번역</span>`)
  if (parts.length === 0) return `<span class="summary-ok">✓ 모든 파일 번역 완료 (${files.value.length}개)</span>`
  return parts.join(' \u00A0 ') + ` <span class="summary-total">(전체 ${files.value.length}개)</span>`
})

function splitBlocks(lines: string[]): Block[] {
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

function checkMismatch(origLines: string[], transLines: string[]): boolean {
  const ob = splitBlocks(origLines), tb = splitBlocks(transLines)
  if (ob.length !== tb.length) return true
  for (let i = 0; i < ob.length; i++) {
    if (ob[i].sep !== tb[i].sep || ob[i].lines.length !== tb[i].lines.length) return true
  }
  return false
}

function loadFiles(dir: string) {
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
  if (!window.nodeFs.existsSync(extractDir) || !window.nodeFs.existsSync(backupDir)) return

  const transFiles: string[] = window.nodeFs.readdirSync(extractDir).filter((f: string) => f.endsWith('.txt'))
  for (const name of transFiles) {
    const origPath = window.nodePath.join(backupDir, name)
    const transPath = window.nodePath.join(extractDir, name)
    if (!window.nodeFs.existsSync(origPath)) continue
    const origContent = window.nodeFs.readFileSync(origPath, 'utf-8')
    const transContent = window.nodeFs.readFileSync(transPath, 'utf-8')
    const mismatch = checkMismatch(origContent.split('\n'), transContent.split('\n'))
    files.value.push({ name, origPath, transPath, mismatch, untranslated: origContent === transContent })
  }
  currentIdx.value = 0
  selectedBlocks.value = new Set()
  updateFilteredFiles()
  renderBlocks()
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
}

function blockStatus(i: number): string {
  const ob = origBlocks.value[i], tb = transBlocks.value[i]
  if (!ob || !tb) return 'missing'
  if (ob.sep !== tb.sep) return 'error-sep'
  const tLines = editedTransLines[i] ?? tb.lines.length
  if (ob.lines.length !== tLines) return 'error-lines'
  return 'ok'
}

function onBlockEdit(i: number, event: Event) {
  const ta = event.target as HTMLTextAreaElement
  editedTransLines[i] = ta.value.split('\n').length
  isDirty.value = true
  dirty[files.value[currentIdx.value].name] = true
  saveStatus.value = ''
}

function toggleSelection(i: number) {
  const s = new Set(selectedBlocks.value)
  if (s.has(i)) s.delete(i); else s.add(i)
  selectedBlocks.value = s
}

let syncing = false
function syncScroll(source: 'orig' | 'trans') {
  if (syncing) return
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
  const f = files.value[currentIdx.value]
  const tb = splitBlocks(window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n'))
  const textareas = document.querySelectorAll('.block-editor') as NodeListOf<HTMLTextAreaElement>
  textareas.forEach((ta, idx) => { if (idx < tb.length) tb[idx].lines = ta.value.split('\n') })
  const parts: string[] = []
  for (const block of tb) { if (block.sep) parts.push(block.sep); parts.push(...block.lines) }
  window.nodeFs.writeFileSync(f.transPath, parts.join('\n'), 'utf-8')
  const origLines = window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n')
  const newTransLines = window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n')
  f.mismatch = checkMismatch(origLines, newTransLines)
  f.untranslated = window.nodeFs.readFileSync(f.origPath, 'utf-8') === window.nodeFs.readFileSync(f.transPath, 'utf-8')
  dirty[f.name] = false
  isDirty.value = false
  saveStatus.value = '저장됨 ✓'
  updateFilteredFiles()
  renderBlocks()
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
  if (!origBlocksEl.value) return
  const blocks = origBlocksEl.value.querySelectorAll('.block') as NodeListOf<HTMLElement>
  const mismatchIdx: number[] = []
  blocks.forEach((b, i) => {
    if (b.classList.contains('error-lines') || b.classList.contains('error-sep') || b.classList.contains('missing'))
      mismatchIdx.push(i)
  })
  if (mismatchIdx.length === 0) return
  const scrollTop = origBlocksEl.value.scrollTop
  let cur = 0
  blocks.forEach((b, i) => { if (b.offsetTop <= scrollTop + 10) cur = i })
  let target = -1
  if (dir === 1) {
    target = mismatchIdx.find(i => i > cur) ?? mismatchIdx[0]
  } else {
    for (let j = mismatchIdx.length - 1; j >= 0; j--) {
      if (mismatchIdx[j] < cur) { target = mismatchIdx[j]; break }
    }
    if (target === -1) target = mismatchIdx[mismatchIdx.length - 1]
  }
  if (target >= 0 && blocks[target]) {
    const tTop = blocks[target].offsetTop - origBlocksEl.value.offsetTop
    origBlocksEl.value.scrollTo({ top: tTop - origBlocksEl.value.clientHeight / 2, behavior: 'smooth' })
    blocks[target].style.outline = '2px solid #ff79c6'
    setTimeout(() => { blocks[target].style.outline = '' }, 1500)
  }
}

onMounted(() => {
  api.on('initCompare', (dir: string) => loadFiles(dir))
  api.on('retranslateProgress', (msg: string) => { saveStatus.value = `🔄 ${msg}` })
  api.on('retranslateFileDone', (result: { success: boolean; error?: string }) => {
    retranslating.value = false
    if (result.success) {
      saveStatus.value = '재번역 완료 ✓'
      const f = files.value[currentIdx.value]
      f.mismatch = checkMismatch(
        window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n'),
        window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n')
      )
      f.untranslated = window.nodeFs.readFileSync(f.origPath, 'utf-8') === window.nodeFs.readFileSync(f.transPath, 'utf-8')
      updateFilteredFiles(); renderBlocks()
    } else { saveStatus.value = `❌ ${result.error || '번역 실패'}` }
  })
  api.on('retranslateBlocksDone', (result: { success: boolean; error?: string }) => {
    retranslating.value = false
    if (result.success) {
      saveStatus.value = `${selectedBlocks.value.size}개 블록 재번역 완료 ✓`
      const f = files.value[currentIdx.value]
      f.mismatch = checkMismatch(
        window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n'),
        window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n')
      )
      f.untranslated = window.nodeFs.readFileSync(f.origPath, 'utf-8') === window.nodeFs.readFileSync(f.transPath, 'utf-8')
      updateFilteredFiles(); renderBlocks()
    } else { saveStatus.value = `❌ ${result.error || '번역 실패'}` }
  })

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
.compare-layout { display: flex; height: 100vh; }
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

.content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.toolbar {
  padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.summary { font-size: 12px; }
.nav-buttons, .action-buttons { display: flex; gap: 4px; align-items: center; }
.nav-buttons button, .action-buttons button {
  padding: 4px 10px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition);
}
.nav-buttons button:hover, .action-buttons button:hover { background: rgba(255,255,255,0.08); }
.nav-buttons button:disabled, .action-buttons button:disabled { opacity: 0.3; cursor: default; }
.selection-count { font-size: 11px; opacity: 0.5; }
.save-status { font-size: 11px; opacity: 0.6; }

.blocks-container { flex: 1; display: flex; overflow: hidden; }
.blocks-col { flex: 1; overflow-y: auto; padding: 8px; }
.col-header {
  font-size: 11px; font-weight: 700; opacity: 0.4; padding: 4px 8px;
  position: sticky; top: 0; background: var(--background); z-index: 1;
}
.block {
  margin-bottom: 4px; padding: 8px 10px; border-radius: 6px; position: relative;
  background: var(--Highlight1); border: 1px solid transparent; font-size: 12px;
}
.blocks-col:first-child .block { padding-left: 40px; }
.block.ok { border-color: rgba(80,250,123,0.1); }
.block.error-lines, .block.error-sep { border-color: rgba(255,85,85,0.3); background: rgba(255,85,85,0.05); }
.block.missing { border-color: rgba(255,184,108,0.3); background: rgba(255,184,108,0.05); }
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
.line-count { position: absolute; bottom: 4px; right: 8px; font-size: 9px; opacity: 0.3; }
pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; font-family: inherit; }
.block-editor {
  width: 100%; background: transparent; border: none; color: var(--mainColor);
  font-size: 12px; font-family: inherit; resize: none; outline: none;
}
:deep(.summary-error) { color: #ff5555; }
:deep(.summary-warn) { color: #f1fa8c; }
:deep(.summary-ok) { color: #50fa7b; }
:deep(.summary-total) { opacity: 0.4; }
</style>
