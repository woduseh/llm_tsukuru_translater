<template>
  <aside class="agent-terminal" :class="{ open: isOpen }" data-harness-agent-terminal>
    <button
      v-if="!isOpen"
      class="agent-chip"
      type="button"
      data-harness-agent-terminal-collapsed
      aria-label="에이전트 터미널 열기"
      @click="openDrawer"
    >
      Agent
      <span>{{ activeSession?.label ?? '세션 없음' }}</span>
    </button>

    <div v-else class="drawer" :class="{ large: isLarge }" data-harness-agent-terminal-open @keydown.esc="closeDrawer">
      <header class="drawer-header">
        <div>
          <strong>에이전트 터미널</strong>
          <span>내장 PTY · 출력은 기본적으로 저장되지 않음</span>
        </div>
        <div class="header-actions">
          <button type="button" :aria-pressed="isLarge" @click="isLarge = !isLarge">
            {{ isLarge ? '보통 크기' : '크게 보기' }}
          </button>
          <button type="button" aria-label="에이전트 터미널 접기" @click="closeDrawer">×</button>
        </div>
      </header>

      <nav v-if="sessions.length" class="session-tabs" role="tablist" aria-label="에이전트 터미널 세션">
        <button
          v-for="session in sessions"
          :key="session.sessionId"
          type="button"
          role="tab"
          :aria-selected="session.sessionId === activeSessionId"
          :aria-controls="`agent-terminal-panel-${session.sessionId}`"
          :class="{ active: session.sessionId === activeSessionId }"
          :data-session-state="session.state"
          @click="activeSessionId = session.sessionId"
        >
          {{ session.label }}
          <span>{{ sessionStateLabel(session.state) }}</span>
        </button>
      </nav>

      <div v-else class="empty-sessions">
        <p>실행 중이거나 이전에 실행한 터미널 세션이 없습니다.</p>
        <div>
          <button type="button" :disabled="launchBusy" @click="launchKind('codex')">Codex 시작</button>
          <button type="button" :disabled="launchBusy" @click="launchKind('claude')">Claude 시작</button>
          <button type="button" :disabled="launchBusy" @click="launchKind('shell')">셸 시작</button>
        </div>
        <p v-if="launchMessage" class="launch-message">{{ launchMessage }}</p>
      </div>

      <section v-if="activeSession" class="terminal-body" :id="`agent-terminal-panel-${activeSession.sessionId}`" role="tabpanel">
        <AgentTerminalPane
          :key="activeSession.sessionId"
          :session="activeSession"
          :launch-kind="activeSession.kind"
          :title="activeSession.label"
          compact
          @launch="launchKind"
        />
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AgentTerminalPane from './AgentTerminalPane.vue'
import { chooseActiveTerminalSessionId, sessionStateLabel } from '../agentWorkspaceModel'
import { useTerminalSessions } from '../composables/useTerminalSessions'
import type { TerminalSessionKind } from '../../types/agentWorkspace'

const { sessions, refresh, launch } = useTerminalSessions()
const isOpen = ref(false)
const isLarge = ref(false)
const launchBusy = ref(false)
const launchMessage = ref('')
const activeSessionId = ref('')

const activeSession = computed(() => {
  return sessions.value.find((session) => session.sessionId === activeSessionId.value) ?? null
})

watch(sessions, (next) => {
  activeSessionId.value = chooseActiveTerminalSessionId(next, activeSessionId.value)
}, { immediate: true })

async function launchKind(kind: TerminalSessionKind) {
  launchBusy.value = true
  launchMessage.value = ''
  try {
    const result = await launch(kind)
    if (result.session) {
      activeSessionId.value = result.session.sessionId
    } else if (!result.ok) {
      launchMessage.value = result.message ?? '터미널을 시작하지 못했습니다.'
    }
  } finally {
    launchBusy.value = false
  }
}

async function openDrawer() {
  isOpen.value = true
  await refresh()
}

function closeDrawer() {
  isOpen.value = false
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
  background: var(--Accent);
  color: #11181b;
  border: none;
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
}

.agent-chip:focus-visible,
.header-actions button:focus-visible,
.session-tabs button:focus-visible {
  outline: 2px solid rgba(180,170,255,0.95);
  outline-offset: 2px;
}

.agent-chip span { font-size: 11px; opacity: 0.78; }

.drawer {
  height: 48vh;
  min-height: 320px;
  max-height: 72vh;
  background: rgba(25,26,36,0.98);
  border: 1px solid rgba(255,176,32,.4);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 36px rgba(0,0,0,0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.drawer.large {
  height: 78vh;
  max-height: calc(100vh - 24px);
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
.drawer-header span { font-size: 11px; opacity: 0.78; }
.header-actions { display: flex; gap: 6px; align-items: center; }
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
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: var(--border);
}

.session-tabs button {
  min-width: 0;
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-family: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.session-tabs button.active { opacity: 1; border-color: rgba(255,176,32,.65); background: #252117; }
.session-tabs span { margin-left: 8px; font-size: 10px; opacity: 0.78; }

.empty-sessions {
  display: grid;
  gap: 10px;
  padding: 18px;
  color: var(--mainColor);
}

.empty-sessions div { display: flex; flex-wrap: wrap; gap: 8px; }
.empty-sessions .launch-message { color: #fca5a5; }
.empty-sessions button {
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-family: inherit;
  cursor: pointer;
}

.terminal-body {
  padding: 8px 10px 10px;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
</style>
