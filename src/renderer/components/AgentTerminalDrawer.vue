<template>
  <aside class="agent-terminal" :class="{ open: drawer.isOpen }" data-harness-agent-terminal>
    <button
      v-if="!drawer.isOpen"
      class="agent-chip"
      type="button"
      data-harness-agent-terminal-collapsed
      @click="openDrawer"
    >
      Agent
      <span>{{ activeSession.label }}</span>
    </button>

    <div v-else class="drawer" data-harness-agent-terminal-open>
      <header class="drawer-header">
        <div>
          <strong>Agent Terminal</strong>
          <span>Mock execution only · output is ephemeral</span>
        </div>
        <div class="header-actions">
          <button type="button" @click="mockStart">Mock start</button>
          <button type="button" @click="mockExit">Mock exit</button>
          <button type="button" aria-label="Collapse Agent terminal" @click="closeDrawer">×</button>
        </div>
      </header>

      <nav class="session-tabs" aria-label="Agent terminal sessions">
        <button
          v-for="session in drawer.sessions"
          :key="session.id"
          type="button"
          :class="{ active: session.id === drawer.activeSessionId }"
          :data-session-state="session.state"
          @click="drawer.activeSessionId = session.id"
        >
          {{ session.label }}
          <span>{{ sessionStateLabel(session.state) }}</span>
        </button>
      </nav>

      <section class="terminal-body">
        <div class="terminal-meta">
          <span class="cwd">cwd: {{ activeSession.cwdLabel }}</span>
          <span class="state" :class="activeSession.state">{{ sessionStateLabel(activeSession.state) }}</span>
          <span>MCP: readonly/mock</span>
          <span>retention: {{ activeSession.outputRetention }}</span>
        </div>

        <pre class="terminal-output" aria-live="polite">{{ terminalPreview }}</pre>

        <div class="terminal-input">
          <span>$</span>
          <input
            v-model="draftCommand"
            type="text"
            placeholder="Command execution is disabled in this scaffold"
            @keyup.enter="mockCommand"
          >
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  applyTerminalEvent,
  createAgentTerminalDrawerState,
  createMockTerminalEvent,
  sessionStateLabel,
  setTerminalDrawerOpen,
} from '../agentWorkspaceModel'

const props = defineProps<{
  cwdLabel?: string
}>()

const drawer = reactive(createAgentTerminalDrawerState(props.cwdLabel))
const draftCommand = ref('')
const sequence = ref(0)

const activeSession = computed(() => {
  return drawer.sessions.find((session) => session.id === drawer.activeSessionId) ?? drawer.sessions[0]
})

const terminalPreview = computed(() => {
  const latest = activeSession.value.latestEvent
  if (!latest) {
    return [
      'Agent terminal scaffold ready.',
      'No privileged process has been spawned.',
      'Terminal output is not persisted by default.',
    ].join('\n')
  }
  return `[${latest.kind}] ${latest.data ?? ''}`
})

function replaceActiveSession(eventKind: 'started' | 'stdout' | 'exit' | 'error', data?: string) {
  const event = createMockTerminalEvent(activeSession.value.id, sequence.value++, eventKind, data)
  const index = drawer.sessions.findIndex((session) => session.id === activeSession.value.id)
  if (index >= 0) {
    drawer.sessions[index] = applyTerminalEvent(drawer.sessions[index], event)
  }
}

function openDrawer() {
  Object.assign(drawer, setTerminalDrawerOpen(drawer, true))
}

function closeDrawer() {
  Object.assign(drawer, setTerminalDrawerOpen(drawer, false))
}

function mockStart() {
  replaceActiveSession('started', `${activeSession.value.label} mock session started`)
}

function mockExit() {
  replaceActiveSession('exit', `${activeSession.value.label} mock session exited`)
}

function mockCommand() {
  const command = draftCommand.value.trim()
  if (!command) return
  replaceActiveSession('stdout', `mock/no-op: ${command}`)
  draftCommand.value = ''
}
</script>

<style scoped>
.agent-terminal {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 40;
  pointer-events: none;
}

.agent-chip, .drawer { pointer-events: auto; }

.agent-chip {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: rgba(124,111,219,0.92);
  color: #fff;
  border: none;
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
}

.agent-chip span { font-size: 11px; opacity: 0.78; }

.drawer {
  height: 32vh;
  min-height: 176px;
  max-height: 48vh;
  background: rgba(25,26,36,0.98);
  border: 1px solid rgba(124,111,219,0.35);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 36px rgba(0,0,0,0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: var(--border);
}

.drawer-header div:first-child { display: flex; flex-direction: column; gap: 2px; }
.drawer-header span { font-size: 11px; opacity: 0.55; }
.header-actions { display: flex; gap: 6px; }
.header-actions button {
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 9px;
  font-family: inherit;
  cursor: pointer;
}

.session-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: var(--border);
}

.session-tabs button {
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-family: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.session-tabs button.active { opacity: 1; border-color: rgba(124,111,219,0.65); }
.session-tabs span { margin-left: 8px; font-size: 10px; opacity: 0.55; }

.terminal-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
.terminal-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; opacity: 0.72; }
.terminal-meta span { padding: 3px 7px; background: rgba(255,255,255,0.05); border-radius: 999px; }
.state.running, .state.idle { color: #83e6a0; }
.state.failed, .state.killed { color: #ff8a8a; }
.terminal-output {
  flex: 1;
  min-height: 42px;
  overflow: auto;
  padding: 10px;
  background: #0f1018;
  border-radius: var(--radius-sm);
  color: #d7ddff;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.terminal-input { display: flex; align-items: center; gap: 8px; }
.terminal-input input {
  flex: 1;
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 9px;
  font-family: Consolas, 'Courier New', monospace;
}
</style>
