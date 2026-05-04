<template>
  <aside class="agent-terminal" :class="{ open: drawer.isOpen }" data-harness-agent-terminal>
    <button
      v-if="!drawer.isOpen"
      class="agent-chip"
      type="button"
      data-harness-agent-terminal-collapsed
      aria-label="에이전트 터미널 열기"
      @click="openDrawer"
    >
      Agent
      <span>{{ activeSession.label }}</span>
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

      <nav class="session-tabs" role="tablist" aria-label="에이전트 터미널 세션">
        <button
          v-for="session in drawer.sessions"
          :key="session.id"
          type="button"
          role="tab"
          :aria-selected="session.id === drawer.activeSessionId"
          :aria-controls="`agent-terminal-panel-${session.id}`"
          :class="{ active: session.id === drawer.activeSessionId }"
          :data-session-state="session.state"
          @click="drawer.activeSessionId = session.id"
        >
          {{ session.label }}
          <span>{{ sessionStateLabel(session.state) }}</span>
        </button>
      </nav>

      <section class="terminal-body" :id="`agent-terminal-panel-${activeSession.id}`" role="tabpanel">
        <AgentTerminalPane
          :key="activeSession.id"
          :kind="activeSession.kind"
          :title="activeSession.label"
          compact
        />
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AgentTerminalPane from './AgentTerminalPane.vue'
import {
  createAgentTerminalDrawerState,
  sessionStateLabel,
  setTerminalDrawerOpen,
} from '../agentWorkspaceModel'

const props = defineProps<{
  cwdLabel?: string
}>()

const drawer = reactive(createAgentTerminalDrawerState(props.cwdLabel))
const isLarge = ref(false)

const activeSession = computed(() => {
  return drawer.sessions.find((session) => session.id === drawer.activeSessionId) ?? drawer.sessions[0]
})

function openDrawer() {
  Object.assign(drawer, setTerminalDrawerOpen(drawer, true))
}

function closeDrawer() {
  Object.assign(drawer, setTerminalDrawerOpen(drawer, false))
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
  border: 1px solid rgba(124,111,219,0.35);
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

.session-tabs button.active { opacity: 1; border-color: rgba(124,111,219,0.65); }
.session-tabs span { margin-left: 8px; font-size: 10px; opacity: 0.78; }

.terminal-body {
  padding: 8px 10px 10px;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
</style>
