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
      <div class="file-list">
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
        <div class="toolbar-row">
          <div class="summary">
            <span v-for="(item, index) in summaryItems" :key="`${item.class}-${index}`" :class="item.class">{{ item.text }}</span>
          </div>
          <div class="nav-buttons">
            <button @click="navigateFile(-1)" title="이전 문제 파일">◀ 파일</button>
            <button @click="navigateFile(1)" title="다음 문제 파일">파일 ▶</button>
            <button :disabled="!hasProblems" @click="navigateBlock(-1)" title="이전 불일치 블록">◀ 블록</button>
            <button :disabled="!hasProblems" @click="navigateBlock(1)" title="다음 불일치 블록">블록 ▶</button>
          </div>
        </div>
        <div class="toolbar-row">
          <span class="group-label">자동 수정</span>
          <span class="selection-count">{{ selectedBlocks.size > 0 ? `${selectedBlocks.size}개 선택` : '' }}</span>
          <button :disabled="selectedBlocks.size === 0" @click="deleteSelectedBlocks"
            title="선택한 번역 블록 삭제">선택 블록 삭제</button>
          <button :disabled="selectedBlocks.size === 0" @click="autoFixSelected"
            title="선택 블록 자동 수정: 빈줄 추가/제거, 구분자 수정">선택 블록 자동 수정</button>
          <button :disabled="files.length === 0" @click="autoFixCurrentFile"
            title="현재 파일의 모든 불일치 블록 자동 수정: 빈줄 추가/제거, 구분자 수정">파일 불일치 자동 수정</button>
          <button :disabled="files.length === 0" @click="autoFixAllMapFiles"
            title="모든 Map***.txt 파일의 불일치 블록 자동 수정 (Map 파일만 안전하게 자동 수정 가능)">전체 불일치 자동 수정</button>
        </div>
        <div class="toolbar-row">
          <span class="group-label">재번역</span>
          <button :disabled="selectedBlocks.size === 0 || retranslating" @click="retranslateSelected">선택 블록 재번역</button>
          <button :disabled="!hasUntranslatedBlocks || retranslating" @click="retranslateUntranslated"
            title="현재 파일의 미번역 블록만 재번역">미번역 블록 재번역</button>
          <button :disabled="files.length === 0 || retranslating" @click="retranslateFile">전체 파일 재번역</button>
        </div>
        <div class="toolbar-row">
          <span class="group-label">저장</span>
          <button :disabled="!isDirty" @click="saveFile">저장</button>
          <span class="save-status">{{ saveStatus }}</span>
        </div>
      </div>

      <!-- Fixed column headers -->
      <div class="blocks-header">
        <div class="col-header">원문</div>
        <div class="col-header">번역</div>
      </div>

      <!-- Virtual-scrolled block comparison -->
      <div class="blocks-viewport" ref="viewportEl" @scroll="onViewportScroll">
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div :style="{ transform: `translateY(${spacerTop}px)`, padding: '8px' }">
            <div v-for="i in visibleIndices" :key="i" class="block-row">
              <div class="block-cell">
                <div class="block" :class="blockClass(i)">
                  <div class="select-indicator" @click.stop="toggleSelection(i)">
                    <input type="checkbox" :checked="selectedBlocks.has(i)" tabindex="-1" @click.prevent>
                  </div>
                  <div v-if="origBlocks[i]?.sep" class="sep-label">{{ origBlocks[i].sep }}</div>
                  <pre>{{ origBlocks[i]?.lines.join('\n') }}</pre>
                  <div class="block-badges">
                    <span v-if="untranslatedBlocks.has(i)" class="badge badge-untranslated-block">미번역</span>
                    <span class="line-count">{{ origBlocks[i]?.lines.length }}줄</span>
                  </div>
                </div>
              </div>
              <div class="block-cell">
                <div class="block" :class="[blockClass(i), selectedBlocks.has(i) ? 'selected' : '']" :data-block-idx="i">
                  <button class="block-delete-btn" @click.stop="deleteBlock(i)" title="이 번역 블록 삭제">✕</button>
                  <div v-if="transBlocks[i]?.sep" class="sep-label">{{ transBlocks[i].sep }}</div>
                  <textarea class="block-editor" :value="transBlocks[i]?.lines.join('\n')"
                    :rows="Math.max(origBlocks[i]?.lines.length || transBlocks[i]?.lines.length || 1, 1)"
                    @input="onBlockEdit(i, $event)"></textarea>
                  <div class="block-badges">
                    <span v-if="untranslatedBlocks.has(i)" class="badge badge-untranslated-block">미번역</span>
                    <span class="line-count">{{ editedTransLines[i] || transBlocks[i]?.lines.length }}줄</span>
                  </div>
                </div>
              </div>
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
import { splitBlocks, checkMismatch, autoFixBlock, isBlockUntranslated, removeDuplicateHeaders, blocksToLines, checkMismatchBlocks, hasAnyUntranslatedBlock } from '../compareUtils'
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

// --- Virtual scroll state ---
const viewportEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(600)
const frozenHeights = ref<number[]>([])
const BLOCK_BASE_H = 48
const BLOCK_LINE_H = 18
const BLOCK_SEP_H = 20
const OVERSCAN = 5

/** Yield to browser event loop so loading overlay can paint before heavy work. */
async function yieldToUI() {
  await nextTick()
  await new Promise<void>(r => setTimeout(r, 0))
}

function computeBlockHeights() {
  const n = Math.max(origBlocks.value.length, transBlocks.value.length)
  const h: number[] = []
  for (let i = 0; i < n; i++) {
    const ob = origBlocks.value[i]
    const tb = transBlocks.value[i]
    const lines = Math.max(ob?.lines.length || 0, tb?.lines.length || 0, 1)
    const sep = (ob?.sep || tb?.sep) ? 1 : 0
    h.push(BLOCK_BASE_H + lines * BLOCK_LINE_H + sep * BLOCK_SEP_H)
  }
  frozenHeights.value = h
}

const blockOffsets = computed(() => {
  const off = [0]
  for (let i = 0; i < frozenHeights.value.length; i++) off.push(off[i] + frozenHeights.value[i])
  return off
})

const totalHeight = computed(() => blockOffsets.value[frozenHeights.value.length] || 0)

const visibleRange = computed(() => {
  const top = scrollTop.value
  const bottom = top + viewportHeight.value
  const n = frozenHeights.value.length
  if (n === 0) return { start: 0, end: -1 }
  let lo = 0, hi = n - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (blockOffsets.value[m + 1] <= top) lo = m + 1
    else hi = m
  }
  let end = lo
  while (end < n && blockOffsets.value[end] < bottom) end++
  return { start: Math.max(0, lo - OVERSCAN), end: Math.min(n - 1, end + OVERSCAN) }
})

const visibleIndices = computed(() => {
  const { start, end } = visibleRange.value
  const r: number[] = []
  for (let i = start; i <= end; i++) r.push(i)
  return r
})

const spacerTop = computed(() => blockOffsets.value[visibleRange.value.start] || 0)

let scrollRafId = 0
function onViewportScroll() {
  if (!scrollRafId) {
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0
      if (viewportEl.value) scrollTop.value = viewportEl.value.scrollTop
    })
  }
}

const hasUntranslatedBlocks = computed(() => untranslatedBlocks.value.size > 0)

/** Whether the current file has any problem blocks (mismatch or untranslated). */
const hasProblems = computed(() => {
  for (let i = 0; i < origBlocks.value.length; i++) {
    if (blockClass(i) !== 'ok') return true
  }
  return false
})

interface SummaryItem {
  class: string
  text: string
}

const summaryItems = computed<SummaryItem[]>(() => {
  if (loading.value) return [{ class: 'summary-loading', text: '⏳ 파일 비교 중...' }]
  if (files.value.length === 0) return [{ class: 'summary-error', text: '비교할 파일이 없습니다.' }]
  const mc = files.value.filter(f => f.mismatch).length
  const uc = files.value.filter(f => f.untranslated).length
  const parts: SummaryItem[] = []
  if (mc > 0) parts.push({ class: 'summary-error', text: `⚠ ${mc}개 줄 수 불일치` })
  if (uc > 0) parts.push({ class: 'summary-warn', text: `● ${uc}개 미번역` })
  if (parts.length === 0) return [{ class: 'summary-ok', text: `✓ 모든 파일 번역 완료 (${files.value.length}개)` }]
  parts.push({ class: 'summary-total', text: `(전체 ${files.value.length}개)` })
  return parts
})

/** Detect untranslated status considering per-block untranslation. */
function checkFileUntranslated(origContent: string, transContent: string): boolean {
  if (origContent === transContent) return true
  return hasAnyUntranslatedBlock(splitBlocks(origContent.split('\n')), splitBlocks(transContent.split('\n')))
}

async function loadFiles(dir: string) {
  loading.value = true
  busy.value = true
  busyMessage.value = '파일 비교 중...'
  await yieldToUI()
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
    // Split once and reuse for both mismatch and untranslated checks
    const ob = splitBlocks(origContent.split('\n'))
    const tb = splitBlocks(transContent.split('\n'))
    const mismatch = checkMismatchBlocks(ob, tb)
    const untranslated = origContent === transContent || hasAnyUntranslatedBlock(ob, tb)
    files.value.push({ name, origPath, transPath, mismatch, untranslated })
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

async function selectFile(idx: number) {
  busy.value = true
  busyMessage.value = '파일 로딩 중...'
  await yieldToUI()
  try {
    currentIdx.value = idx
    renderBlocks()
  } finally {
    busy.value = false
  }
}

function renderBlocks() {
  if (files.value.length === 0) { origBlocks.value = []; transBlocks.value = []; frozenHeights.value = []; return }
  const f = files.value[currentIdx.value]
  origBlocks.value = splitBlocks(window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n'))
  transBlocks.value = splitBlocks(window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n'))
  selectedBlocks.value = new Set()
  isDirty.value = false
  saveStatus.value = ''
  for (const k in editedTransLines) delete editedTransLines[k]
  updateUntranslatedBlocks()
  computeBlockHeights()
  scrollTop.value = 0
  if (viewportEl.value) viewportEl.value.scrollTop = 0
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

function deleteBlock(i: number) {
  if (i < 0 || i >= transBlocks.value.length) return
  transBlocks.value.splice(i, 1)
  // Rebuild editedTransLines with shifted indices
  const newEdited: Record<number, number> = {}
  for (const k in editedTransLines) {
    const idx = Number(k)
    if (idx < i) newEdited[idx] = editedTransLines[idx]
    else if (idx > i) newEdited[idx - 1] = editedTransLines[idx]
  }
  for (const k in editedTransLines) delete editedTransLines[k]
  Object.assign(editedTransLines, newEdited)
  selectedBlocks.value = new Set()
  isDirty.value = true
  dirty[files.value[currentIdx.value].name] = true
  saveStatus.value = '블록 삭제됨'
  updateUntranslatedBlocks()
  computeBlockHeights()
}

function deleteSelectedBlocks() {
  if (selectedBlocks.value.size === 0) return
  const indices = Array.from(selectedBlocks.value).sort((a, b) => b - a) // descending
  for (const i of indices) {
    if (i >= 0 && i < transBlocks.value.length) transBlocks.value.splice(i, 1)
  }
  // Rebuild editedTransLines
  for (const k in editedTransLines) delete editedTransLines[k]
  selectedBlocks.value = new Set()
  isDirty.value = true
  dirty[files.value[currentIdx.value].name] = true
  saveStatus.value = `${indices.length}개 블록 삭제됨`
  updateUntranslatedBlocks()
  computeBlockHeights()
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
    computeBlockHeights()
  }
}

async function autoFixCurrentFile() {
  busy.value = true
  busyMessage.value = '자동 수정 중...'
  await yieldToUI()
  try {
    let count = 0
    // Remove duplicate consecutive headers first
    const dupRemoved = removeDuplicateHeaders(transBlocks.value)
    count += dupRemoved
    for (let i = 0; i < origBlocks.value.length; i++) {
      if (autoFixBlock(origBlocks.value[i], transBlocks.value[i])) {
        editedTransLines[i] = transBlocks.value[i].lines.length
        count++
      }
    }
    if (count > 0) {
      if (dupRemoved > 0) for (const k in editedTransLines) delete editedTransLines[k]
      isDirty.value = true
      dirty[files.value[currentIdx.value].name] = true
      saveStatus.value = dupRemoved > 0
        ? `${count}개 블록 수정됨 (중복 헤더 ${dupRemoved}개 제거 포함)`
        : `${count}개 블록 자동 수정됨`
      updateUntranslatedBlocks()
      computeBlockHeights()
    }
  } finally {
    busy.value = false
  }
}

/** Auto-fix + save all Map***.txt files. Other files are skipped due to higher error risk. */
async function autoFixAllMapFiles() {
  const MAP_RE = /^Map\d+\.txt$/i
  busy.value = true
  busyMessage.value = '전체 Map 파일 자동 수정 중...'
  await yieldToUI()
  let totalFixed = 0, filesFixed = 0
  try {
    for (let fi = 0; fi < files.value.length; fi++) {
      const f = files.value[fi]
      if (!MAP_RE.test(f.name) || !f.mismatch) continue
      const ob = splitBlocks(window.nodeFs.readFileSync(f.origPath, 'utf-8').split('\n'))
      const tb = splitBlocks(window.nodeFs.readFileSync(f.transPath, 'utf-8').split('\n'))
      let count = removeDuplicateHeaders(tb)
      for (let i = 0; i < ob.length; i++) {
        if (autoFixBlock(ob[i], tb[i])) count++
      }
      if (count > 0) {
        window.nodeFs.writeFileSync(f.transPath, blocksToLines(tb).join('\n'), 'utf-8')
        // Use in-memory blocks instead of re-reading files
        f.mismatch = checkMismatchBlocks(ob, tb)
        f.untranslated = hasAnyUntranslatedBlock(ob, tb)
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

async function saveFile() {
  if (files.value.length === 0) return
  busy.value = true
  busyMessage.value = '저장 중...'
  await yieldToUI()
  try {
    const f = files.value[currentIdx.value]
    window.nodeFs.writeFileSync(f.transPath, blocksToLines(transBlocks.value).join('\n'), 'utf-8')
    // Use in-memory blocks instead of re-reading files
    f.mismatch = checkMismatchBlocks(origBlocks.value, transBlocks.value)
    f.untranslated = hasAnyUntranslatedBlock(origBlocks.value, transBlocks.value)
    dirty[f.name] = false
    isDirty.value = false
    saveStatus.value = '저장됨 ✓'
    selectedBlocks.value = new Set()
    for (const k in editedTransLines) delete editedTransLines[k]
    updateUntranslatedBlocks()
    updateFilteredFiles()
    computeBlockHeights()
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
  const problemIdx: number[] = []
  for (let i = 0; i < origBlocks.value.length; i++) {
    if (blockClass(i) !== 'ok') problemIdx.push(i)
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
  // Scroll viewport to center the target block
  if (viewportEl.value) {
    const targetTop = blockOffsets.value[target] || 0
    const targetH = frozenHeights.value[target] || 0
    viewportEl.value.scrollTo({ top: targetTop - (viewportHeight.value - targetH) / 2, behavior: 'smooth' })
  }
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

let resizeObs: ResizeObserver | null = null

onMounted(() => {
  api.on('initCompare', (dir: string) => loadFiles(dir))
  api.on('retranslateProgress', (msg: string) => { saveStatus.value = `🔄 ${msg}` })
  api.on('retranslateFileDone', onRetranslateResult)
  api.on('retranslateBlocksDone', onRetranslateResult)

  document.addEventListener('keydown', onKeydown)

  // Initialize virtual scroll viewport
  if (viewportEl.value) {
    viewportHeight.value = viewportEl.value.clientHeight || 600
    resizeObs = new ResizeObserver(entries => {
      for (const entry of entries) viewportHeight.value = entry.contentRect.height
    })
    resizeObs.observe(viewportEl.value)
  }

  api.send('compareReady')
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
  resizeObs?.disconnect()
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

/* Toolbar - vertical layout with 4 rows */
.toolbar {
  padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column; gap: 4px;
  flex-shrink: 0;
}
.toolbar-row { display: flex; align-items: center; gap: 8px; }
.summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; white-space: nowrap; }
.nav-buttons { display: flex; gap: 3px; align-items: center; margin-left: auto; }
.group-label { font-size: 9px; opacity: 0.35; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; min-width: 48px; }
.nav-buttons button, .toolbar-row button {
  padding: 3px 8px; font-size: 11px; background: var(--Highlight1);
  border: var(--border); border-radius: 4px; color: var(--mainColor);
  cursor: pointer; font-family: inherit; transition: var(--transition); white-space: nowrap;
}
.nav-buttons button:hover, .toolbar-row button:hover { background: rgba(255,255,255,0.08); }
.nav-buttons button:disabled, .toolbar-row button:disabled { opacity: 0.3; cursor: default; }
.selection-count { font-size: 10px; opacity: 0.5; white-space: nowrap; }
.save-status { font-size: 11px; opacity: 0.6; white-space: nowrap; }

/* Fixed column headers */
.blocks-header {
  display: flex; flex-shrink: 0; padding: 0 8px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.col-header {
  flex: 1; font-size: 11px; font-weight: 700; opacity: 0.4;
  padding: 4px 8px 6px;
}

/* Virtual-scrolled viewport */
.blocks-viewport { flex: 1; overflow-y: auto; }
.block-row { display: flex; gap: 8px; margin-bottom: 4px; }
.block-cell { flex: 1; min-width: 0; }
.block {
  padding: 8px 10px; border-radius: 6px; position: relative;
  background: var(--Highlight1); border: 1px solid transparent; font-size: 12px;
  box-sizing: border-box; height: 100%;
}
.block-cell:first-child .block { padding-left: 40px; }
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
.block-delete-btn {
  position: absolute; top: 4px; right: 4px; z-index: 1;
  width: 20px; height: 20px; padding: 0; border: none; border-radius: 4px;
  background: rgba(255,85,85,0.15); color: #ff5555; font-size: 12px; line-height: 20px;
  cursor: pointer; opacity: 0; transition: opacity 0.15s;
}
.block:hover .block-delete-btn { opacity: 0.6; }
.block-delete-btn:hover { opacity: 1 !important; background: rgba(255,85,85,0.3); }
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
