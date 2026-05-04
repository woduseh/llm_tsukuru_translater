<template>
  <TitleBar :show-settings="true" @settings="openSettings" />

  <main class="agent-workspace" data-harness-view="agent-workspace">
    <section class="workspace-hero">
      <div>
        <p class="eyebrow">AI 작업공간</p>
        <h1>{{ workspace.title }}</h1>
        <p>{{ workspace.subtitle }}</p>
      </div>
      <button type="button" class="btn-secondary" @click="$router.push('/')">홈으로</button>
    </section>

    <section class="workspace-grid">
      <div class="panel navigator">
        <h2>명령 프리셋</h2>
        <button
          v-for="preset in workspace.presets"
          :key="preset.id"
          type="button"
          class="preset"
          :data-risk="preset.risk"
        >
          <strong>{{ preset.title }}</strong>
          <span>{{ preset.description }}</span>
          <small>{{ riskLevelLabel(preset.risk) }} · {{ preset.estimated }}</small>
        </button>
      </div>

      <div class="panel terminal-pane">
        <div class="panel-heading">
          <h2>에이전트 프리셋</h2>
          <span>미리보기 / 자동 실행 안 함</span>
        </div>
        <div class="agent-preset-tabs">
          <button
            v-for="preset in workspace.agentPresets"
            :key="preset.id"
            type="button"
            :class="{ active: preset.id === activeAgentPreset.id }"
            :data-mcp-status="preset.mcpStatus"
            @click="activeAgentPresetId = preset.id"
          >
            {{ preset.title }}
            <span>{{ mcpStatusLabel(preset.mcpStatus) }}</span>
          </button>
        </div>
        <div class="command-preview">
          <strong>{{ activeAgentPreset.description }}</strong>
          <code>{{ activeAgentPreset.commandPreview }}</code>
          <p>{{ activeAgentPreset.executable.detectionMessage }}</p>
          <p>{{ activeAgentPreset.mcpMessage }}</p>
        </div>
        <div class="starter-prompts">
          <button
            v-for="prompt in activeAgentPreset.starterPrompts"
            :key="prompt.id"
            type="button"
            @click="useStarterPrompt(prompt)"
          >
            {{ prompt.action === 'copy' ? '복사' : '제안' }} · {{ prompt.title }}
          </button>
        </div>
        <pre v-if="selectedPrompt" class="prompt-preview">{{ selectedPrompt }}</pre>
        <div class="panel-heading terminal-heading">
          <h2>터미널 세션</h2>
          <span>내장 PTY / 대체 안내</span>
        </div>
        <div class="workspace-tabs">
          <button
            v-for="session in workspace.drawer.sessions"
            :key="session.id"
            type="button"
            :class="{ active: session.id === workspace.drawer.activeSessionId }"
            :data-session-state="session.state"
            @click="workspace.drawer.activeSessionId = session.id"
          >
            {{ session.label }}
            <span>{{ sessionStateLabel(session.state) }}</span>
          </button>
        </div>
        <div class="terminal-placeholder">
          <AgentTerminalPane :key="activeSession.id" :kind="activeSession.kind" :title="activeSession.label" />
        </div>
      </div>

      <div class="panel context-pane">
        <h2>활동 및 승인</h2>
        <ol class="timeline">
          <li v-for="item in workspace.timeline" :key="item.id" :data-status="item.status">
            <span>{{ timelineStatusLabel(item.status) }}</span>
            {{ item.title }}
          </li>
        </ol>
        <div class="approval-card">
          <strong>승인 센터</strong>
          <p>쓰기 또는 실행 승인이 필요하면 이곳에 표시됩니다.</p>
        </div>
        <div class="mcp-states">
          <div v-for="state in workspace.mcpStatusCards" :key="state.status" :data-mcp-state="state.status">
            <strong>{{ state.label }}</strong>
            <p>{{ state.description }}</p>
          </div>
        </div>
        <ul class="safety-list">
          <li v-for="item in workspace.safetyGuidance" :key="item">{{ item }}</li>
        </ul>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import TitleBar from '../components/TitleBar.vue'
import AgentTerminalPane from '../components/AgentTerminalPane.vue'
import { api } from '../composables/useIpc'
import {
  createAgentWorkspaceViewModel,
  mcpStatusLabel,
  sessionStateLabel,
  type AgentCliPreset,
  type CommandRiskLevel,
  type AgentStarterPrompt,
} from '../agentWorkspaceModel'

const workspace = reactive(createAgentWorkspaceViewModel())
const activeAgentPresetId = ref<AgentCliPreset['id']>(workspace.agentPresets[0].id)
const selectedPrompt = ref('')
const activeSession = computed(() => {
  return workspace.drawer.sessions.find((session) => session.id === workspace.drawer.activeSessionId) ?? workspace.drawer.sessions[0]
})
const activeAgentPreset = computed(() => {
  return workspace.agentPresets.find((preset) => preset.id === activeAgentPresetId.value) ?? workspace.agentPresets[0]
})

function openSettings() {
  api.send('settings')
}

async function useStarterPrompt(prompt: AgentStarterPrompt) {
  selectedPrompt.value = prompt.prompt
  if (prompt.action === 'copy' && navigator.clipboard) {
    await navigator.clipboard.writeText(prompt.prompt)
  }
}

function riskLevelLabel(risk: CommandRiskLevel): string {
  const labels: Record<CommandRiskLevel, string> = {
    safe: '안전',
    review: '검토',
    write: '쓰기',
    dangerous: '고위험',
  }
  return labels[risk]
}

function timelineStatusLabel(status: 'ready' | 'waiting' | 'mocked'): string {
  const labels = {
    ready: '준비됨',
    waiting: '대기',
    mocked: '미리보기',
  } satisfies Record<'ready' | 'waiting' | 'mocked', string>
  return labels[status]
}
</script>

<style scoped>
.agent-workspace {
  flex: 1;
  overflow: auto;
  padding: 20px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.workspace-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  background: linear-gradient(135deg, rgba(124,111,219,0.18), rgba(42,43,61,0.72));
  border: var(--border);
  border-radius: var(--radius-lg);
}

.eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 1.4px; opacity: 0.5; }
.workspace-hero h1 { margin: 4px 0; font-size: 24px; }
.workspace-hero p:last-child { opacity: 0.68; font-size: 13px; }

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.45fr) minmax(0, 0.95fr);
  grid-template-areas: "navigator terminal context";
  gap: 14px;
  min-height: 0;
  align-items: start;
}

.panel {
  background: var(--Highlight2);
  border: var(--border);
  border-radius: var(--radius-lg);
  padding: 14px;
  min-height: 280px;
  min-width: 0;
  overflow: hidden;
}

.panel h2 { font-size: 14px; margin-bottom: 10px; }
.panel-heading { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; min-width: 0; }
.panel-heading span { font-size: 11px; opacity: 0.78; overflow-wrap: anywhere; }
.terminal-heading { margin-top: 14px; }

.navigator { grid-area: navigator; }
.terminal-pane { grid-area: terminal; }
.context-pane { grid-area: context; }
.navigator, .context-pane { display: flex; flex-direction: column; gap: 8px; }
.terminal-pane { display: flex; flex-direction: column; min-height: clamp(520px, 72vh, 840px); }
.preset {
  text-align: left;
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-md);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: inherit;
  cursor: default;
  min-width: 0;
}
.preset strong, .preset span, .preset small { overflow-wrap: anywhere; }
.preset span { font-size: 11px; opacity: 0.82; line-height: 1.35; }
.preset small { font-size: 10px; opacity: 0.72; }

.agent-preset-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.agent-preset-tabs button {
  flex: 1 1 128px;
  min-width: 0;
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-family: inherit;
  text-align: left;
}
.agent-preset-tabs button.active { border-color: rgba(124,111,219,0.7); background: rgba(124,111,219,0.16); }
.agent-preset-tabs span { display: block; margin-top: 2px; font-size: 10px; opacity: 0.76; overflow-wrap: anywhere; }

.command-preview, .prompt-preview {
  background: #0f1018;
  color: #d7ddff;
  border-radius: var(--radius-md);
  padding: 10px;
  font-size: 12px;
  min-width: 0;
}
.command-preview { display: flex; flex-direction: column; gap: 7px; }
.command-preview code, .prompt-preview { font-family: Consolas, 'Courier New', monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.command-preview p { opacity: 0.82; line-height: 1.4; overflow-wrap: anywhere; }
.starter-prompts { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.starter-prompts button {
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: 11px;
}

.workspace-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.workspace-tabs button {
  flex: 1 1 110px;
  min-width: 0;
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-family: inherit;
}
.workspace-tabs button.active { border-color: rgba(124,111,219,0.7); background: rgba(124,111,219,0.16); }
.workspace-tabs span { margin-left: 8px; font-size: 10px; opacity: 0.76; }

.terminal-placeholder {
  flex: 1;
  min-height: clamp(360px, 50vh, 680px);
  border-radius: var(--radius-md);
  background: #0f1018;
  padding: 10px;
  color: #d7ddff;
  min-width: 0;
  overflow: hidden;
}
.terminal-placeholder p { margin-top: 8px; opacity: 0.82; font-size: 12px; line-height: 1.5; }

.timeline { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.timeline li { padding: 9px; background: var(--Highlight1); border-radius: var(--radius-sm); font-size: 12px; }
.timeline span { margin-right: 8px; opacity: 0.78; font-size: 10px; }
.approval-card { margin-top: 14px; padding: 12px; border: 1px dashed rgba(124,111,219,0.45); border-radius: var(--radius-md); }
.approval-card p { margin-top: 6px; font-size: 12px; opacity: 0.82; }
.mcp-states { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.mcp-states div { padding: 9px; border-radius: var(--radius-sm); background: var(--Highlight1); }
.mcp-states p, .safety-list { margin-top: 4px; font-size: 11px; line-height: 1.45; opacity: 0.82; }
.safety-list { padding-left: 18px; }
.safety-list li + li { margin-top: 4px; }

@media (max-width: 1200px) {
  .workspace-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "terminal terminal"
      "navigator context";
  }
  .terminal-pane {
    min-height: clamp(460px, 62vh, 720px);
  }
}

@media (max-width: 900px) {
  .workspace-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .workspace-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "terminal"
      "navigator"
      "context";
  }
  .terminal-placeholder {
    min-height: 360px;
  }
}

@media (max-width: 840px) {
  .workspace-grid { grid-template-columns: 1fr; }
}
</style>
