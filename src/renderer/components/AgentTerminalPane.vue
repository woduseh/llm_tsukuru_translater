<template>
  <section class="terminal-pane" :class="{ compact: props.compact }" data-harness-agent-terminal-pane>
    <header class="terminal-toolbar">
      <div>
        <strong>{{ title }}</strong>
        <span>{{ statusLabel }}</span>
      </div>
      <div class="terminal-actions">
        <button type="button" :disabled="!recentOutput" @click="copyLastError">오류 복사</button>
        <button type="button" :disabled="!recentOutput" @click="copyOutput">출력 복사</button>
        <button type="button" :aria-pressed="followOutput" @click="followOutput = !followOutput">
          {{ followOutput ? '자동 스크롤' : '수동 스크롤' }}
        </button>
        <button type="button" @click="clearTerminal">지우기</button>
        <button type="button" :disabled="starting || isRunning" @click="startSession">시작</button>
        <button type="button" :disabled="!activeSessionId || !isRunning" @click="killSession">종료</button>
      </div>
    </header>

    <div class="terminal-details" aria-live="polite">
      <span>{{ capabilityLabel }}</span>
      <span v-if="sessionSummary">폴더: {{ sessionSummary.cwdLabel }}</span>
      <span v-if="sessionSummary">이벤트: {{ sessionSummary.latestSequence }}</span>
      <span v-if="sessionSummary?.truncationCount">잘림: {{ sessionSummary.truncationCount }}</span>
    </div>
    <p class="terminal-helper">터미널에 입력하려면 검은 출력 영역을 클릭한 뒤 키보드로 입력하세요.</p>

    <div
      ref="terminalHost"
      class="terminal-host"
      role="textbox"
      :aria-label="`${title} 터미널 출력`"
      tabindex="0"
      @paste.prevent="handlePaste"
    />

    <p v-if="message" class="terminal-message" :data-kind="messageKind">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../composables/useIpc'
import type {
  TerminalCapability,
  TerminalEvent,
  TerminalOperationResult,
  TerminalSessionKind,
  TerminalSessionSummary,
} from '../../types/agentWorkspace'

const props = defineProps<{
  kind?: TerminalSessionKind
  title?: string
  compact?: boolean
}>()

const terminalHost = ref<HTMLElement | null>(null)
const terminal = ref<Terminal | null>(null)
const fitAddon = ref<FitAddon | null>(null)
const sessionSummary = ref<TerminalSessionSummary | null>(null)
const activeSessionId = ref('')
const lastSequence = ref(0)
const capability = ref<TerminalCapability | null>(null)
const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
const starting = ref(false)
const recentOutput = ref('')
const lastErrorOutput = ref('')
const followOutput = ref(true)
let unsubscribeEvent: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let flushTimer: number | null = null
let pendingOutput = ''

const kind = computed<TerminalSessionKind>(() => props.kind ?? 'shell')
const title = computed(() => props.title ?? terminalTitle(kind.value))
const isRunning = computed(() => sessionSummary.value?.state === 'running' || sessionSummary.value?.state === 'idle')
const statusLabel = computed(() => {
  if (starting.value) return '시작 중'
  if (sessionSummary.value) return stateLabel(sessionSummary.value.state)
  return '대기 중'
})
const capabilityLabel = computed(() => {
  if (!capability.value) return '터미널 상태 확인 중'
  if (capability.value.status === 'enabled') return '내장 터미널 사용 가능'
  return `대체 모드: ${capability.value.fallbackHint || capability.value.reason || '터미널을 사용할 수 없습니다'}`
})

onMounted(async () => {
  mountTerminal()
  unsubscribeEvent = api.terminal.onEvent(handleTerminalEvent)
  await refreshSessions()
})

onUnmounted(() => {
  if (unsubscribeEvent) unsubscribeEvent()
  if (resizeObserver) resizeObserver.disconnect()
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  terminal.value?.dispose()
  fitAddon.value?.dispose()
})

watch(() => props.kind, async () => {
  await refreshSessions()
})

async function refreshSessions() {
  const result = await api.terminal.list()
  applyOperationResult(result)
  const existing = result.sessions?.find((session) => session.kind === kind.value && ['running', 'idle', 'starting'].includes(session.state))
  if (existing) {
    sessionSummary.value = existing
    activeSessionId.value = existing.sessionId
    await replaySnapshot()
  } else {
    sessionSummary.value = null
    activeSessionId.value = ''
    lastSequence.value = 0
    terminal.value?.clear()
    recentOutput.value = ''
    lastErrorOutput.value = ''
  }
}

function mountTerminal() {
  if (!terminalHost.value || terminal.value) return
  const term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    disableStdin: false,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: props.compact ? 12 : 13,
    scrollback: 8000,
    theme: {
      background: '#0f1018',
      foreground: '#d7ddff',
      cursor: '#ffffff',
    },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(terminalHost.value)
  terminal.value = term
  fitAddon.value = fit
  nextTick(() => fitTerminal())
  term.onData((data) => {
    if (!activeSessionId.value) return
    void api.terminal.input({
      schemaVersion: 1,
      sessionId: activeSessionId.value,
      data,
    }).then(applyOperationResult)
  })
  resizeObserver = new ResizeObserver(() => {
    window.setTimeout(() => fitTerminal(), 25)
  })
  resizeObserver.observe(terminalHost.value)
}

async function startSession() {
  starting.value = true
  message.value = ''
  terminal.value?.clear()
  try {
    const result = await api.terminal.create({
      schemaVersion: 1,
      requestId: `renderer-${Date.now()}`,
      kind: kind.value,
      cols: terminal.value?.cols,
      rows: terminal.value?.rows,
    })
    applyOperationResult(result)
    if (result.ok && result.session) {
      sessionSummary.value = result.session
      activeSessionId.value = result.session.sessionId
      lastSequence.value = result.session.latestSequence
      terminal.value?.focus()
    }
  } finally {
    starting.value = false
  }
}

async function killSession() {
  if (!activeSessionId.value) return
  const result = await api.terminal.kill({ schemaVersion: 1, sessionId: activeSessionId.value })
  applyOperationResult(result)
}

async function replaySnapshot() {
  if (!activeSessionId.value) return
  const result = await api.terminal.snapshot({
    schemaVersion: 1,
    sessionId: activeSessionId.value,
    afterSequence: 0,
  })
  applyOperationResult(result)
  terminal.value?.clear()
  recentOutput.value = ''
  lastErrorOutput.value = ''
  for (const event of result.snapshot?.events ?? []) {
    appendEvent(event)
  }
}

function handleTerminalEvent(event: TerminalEvent) {
  if (event.sessionId !== activeSessionId.value) return
  if (event.sequence <= lastSequence.value) return
  appendEvent(event)
}

function appendEvent(event: TerminalEvent) {
  lastSequence.value = event.sequence
  if (event.kind === 'stdout' || event.kind === 'stderr' || event.kind === 'truncated' || event.kind === 'started' || event.kind === 'error') {
    const prefix = event.kind === 'error' ? '\r\n[오류] ' : event.kind === 'truncated' ? '\r\n[잘림] ' : ''
    const chunk = `${prefix}${event.data ?? ''}`
    pendingOutput += chunk
    rememberOutput(chunk, event.kind === 'stderr' || event.kind === 'error' || event.kind === 'truncated')
    scheduleFlush()
  }
  if (event.kind === 'exit') {
    const chunk = `\r\n${event.data ?? '세션이 종료되었습니다.'}\r\n`
    pendingOutput += chunk
    if (event.exitCode && event.exitCode !== 0) rememberOutput(chunk, true)
    scheduleFlush()
  }
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
      terminal.value?.write(pendingOutput)
      if (followOutput.value) terminal.value?.scrollToBottom()
      pendingOutput = ''
      flushTimer = null
    }, 25)
}

function rememberOutput(chunk: string, errorLike = false) {
  recentOutput.value = `${recentOutput.value}${chunk}`.slice(-32000)
  if (errorLike) lastErrorOutput.value = `${lastErrorOutput.value}${chunk}`.slice(-12000)
}

async function handlePaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  if (!text || !activeSessionId.value) return
  const needsConfirm = text.includes('\n') || text.length > 2000 || /api[_-]?key|secret|token|password|Bearer\s+/i.test(text)
  if (needsConfirm && !window.confirm('여러 줄이거나 비밀값처럼 보이는 내용을 터미널에 붙여넣습니다. 계속할까요?')) {
    return
  }
  const result = await api.terminal.input({
    schemaVersion: 1,
    sessionId: activeSessionId.value,
    data: text,
    paste: true,
    confirmed: needsConfirm,
  })
  applyOperationResult(result)
}

function fitTerminal() {
  if (!fitAddon.value || !terminal.value || !terminalHost.value) return
  try {
    fitAddon.value.fit()
    if (activeSessionId.value) {
      void api.terminal.resize({
        schemaVersion: 1,
        sessionId: activeSessionId.value,
        cols: terminal.value.cols,
        rows: terminal.value.rows,
      })
    }
  } catch {
    // xterm can throw while hidden during route transitions; the next resize will retry.
  }
}

function applyOperationResult(result: TerminalOperationResult) {
  capability.value = result.capability ?? capability.value
  if (result.session) {
    sessionSummary.value = result.session
    activeSessionId.value = result.session.sessionId
  }
  if (!result.ok) {
    messageKind.value = 'error'
    message.value = result.message || '터미널 작업에 실패했습니다.'
  } else if (result.capability?.status !== 'enabled') {
    messageKind.value = 'info'
    message.value = result.capability?.fallbackHint || result.capability?.reason || ''
  } else {
    message.value = ''
  }
}

async function copyLastError() {
  await copyText(lastErrorOutput.value || recentOutput.value)
}

async function copyOutput() {
  await copyText(recentOutput.value)
}

function clearTerminal() {
  terminal.value?.clear()
  recentOutput.value = ''
  lastErrorOutput.value = ''
  message.value = ''
}

async function copyText(text: string) {
  if (!text || !navigator.clipboard) return
  await navigator.clipboard.writeText(text)
  messageKind.value = 'info'
  message.value = '터미널 출력이 클립보드에 복사되었습니다.'
}

function terminalTitle(sessionKind: TerminalSessionKind): string {
  if (sessionKind === 'codex') return 'Codex CLI'
  if (sessionKind === 'claude') return 'Claude CLI'
  if (sessionKind === 'custom') return '사용자 지정 터미널'
  return 'PowerShell'
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    created: '생성됨',
    starting: '시작 중',
    running: '실행 중',
    idle: '대기 중',
    exited: '종료됨',
    failed: '실패',
    killed: '강제 종료됨',
    unavailable: '사용 불가',
    reconnecting: '다시 연결 중',
  }
  return labels[state] || state
}
</script>

<style scoped>
.terminal-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
  min-width: 0;
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.terminal-toolbar > div:first-child { display: flex; flex-direction: column; gap: 2px; }
.terminal-toolbar span, .terminal-details, .terminal-helper { font-size: 11px; opacity: 0.78; }
.terminal-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.terminal-actions button {
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 9px;
  font-family: inherit;
  cursor: pointer;
}
.terminal-actions button:disabled { opacity: 0.45; cursor: not-allowed; }

.terminal-details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.terminal-details span {
  padding: 3px 7px;
  background: rgba(255,255,255,0.05);
  border-radius: 999px;
  overflow-wrap: anywhere;
}

.terminal-helper {
  margin: 0;
  line-height: 1.35;
}

.terminal-host {
  flex: 1;
  min-height: 320px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: #0f1018;
  padding: 4px;
  min-width: 0;
}

.terminal-pane.compact .terminal-host {
  min-height: 220px;
}

:deep(.xterm),
:deep(.xterm-screen),
:deep(.xterm-viewport) {
  height: 100%;
}

:deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.terminal-message {
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.9;
  max-height: 92px;
  overflow: auto;
  white-space: pre-wrap;
}
.terminal-message[data-kind="error"] { color: #ff9c9c; }
</style>
