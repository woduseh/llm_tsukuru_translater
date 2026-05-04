<template>
  <TitleBar :show-settings="true" @settings="openSettings" />

  <main class="agent-workspace" data-harness-view="agent-workspace">
    <section class="workspace-hero">
      <div>
        <p class="eyebrow">Agent Workspace</p>
        <h1>{{ workspace.title }}</h1>
        <p>{{ workspace.subtitle }}</p>
      </div>
      <button type="button" class="btn-secondary" @click="$router.push('/')">홈으로</button>
    </section>

    <section class="workspace-grid">
      <div class="panel navigator">
        <h2>Command presets</h2>
        <button
          v-for="preset in workspace.presets"
          :key="preset.id"
          type="button"
          class="preset"
          :data-risk="preset.risk"
        >
          <strong>{{ preset.title }}</strong>
          <span>{{ preset.description }}</span>
          <small>{{ preset.risk }} · {{ preset.estimated }}</small>
        </button>
      </div>

      <div class="panel terminal-pane">
        <div class="panel-heading">
          <h2>Agent presets</h2>
          <span>Preview/no auto-run</span>
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
            {{ prompt.action === 'copy' ? 'Copy' : 'Suggest' }} · {{ prompt.title }}
          </button>
        </div>
        <pre v-if="selectedPrompt" class="prompt-preview">{{ selectedPrompt }}</pre>
        <div class="panel-heading terminal-heading">
          <h2>Terminal sessions</h2>
          <span>Native PTY / degraded fallback</span>
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
        <h2>Activity & approvals</h2>
        <ol class="timeline">
          <li v-for="item in workspace.timeline" :key="item.id" :data-status="item.status">
            <span>{{ item.status }}</span>
            {{ item.title }}
          </li>
        </ol>
        <div class="approval-card">
          <strong>Approval center placeholder</strong>
          <p>No write or execute action can run from this scaffold.</p>
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
</script>

<style scoped>
.agent-workspace {
  flex: 1;
  overflow: auto;
  padding: 20px 24px 72px;
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  grid-template-columns: minmax(190px, 0.85fr) minmax(260px, 1.4fr) minmax(200px, 1fr);
  gap: 14px;
  min-height: 0;
}

.panel {
  background: var(--Highlight2);
  border: var(--border);
  border-radius: var(--radius-lg);
  padding: 14px;
  min-height: 280px;
}

.panel h2 { font-size: 14px; margin-bottom: 10px; }
.panel-heading { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.panel-heading span { font-size: 11px; opacity: 0.55; }
.terminal-heading { margin-top: 14px; }

.navigator { display: flex; flex-direction: column; gap: 8px; }
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
}
.preset span { font-size: 11px; opacity: 0.62; line-height: 1.35; }
.preset small { font-size: 10px; opacity: 0.46; }

.agent-preset-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.agent-preset-tabs button {
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-family: inherit;
  text-align: left;
}
.agent-preset-tabs button.active { border-color: rgba(124,111,219,0.7); background: rgba(124,111,219,0.16); }
.agent-preset-tabs span { display: block; margin-top: 2px; font-size: 10px; opacity: 0.55; }

.command-preview, .prompt-preview {
  background: #0f1018;
  color: #d7ddff;
  border-radius: var(--radius-md);
  padding: 10px;
  font-size: 12px;
}
.command-preview { display: flex; flex-direction: column; gap: 7px; }
.command-preview code, .prompt-preview { font-family: Consolas, 'Courier New', monospace; white-space: pre-wrap; }
.command-preview p { opacity: 0.62; line-height: 1.4; }
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
  background: var(--Highlight3);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-family: inherit;
}
.workspace-tabs button.active { border-color: rgba(124,111,219,0.7); background: rgba(124,111,219,0.16); }
.workspace-tabs span { margin-left: 8px; font-size: 10px; opacity: 0.55; }

.terminal-placeholder {
  min-height: 168px;
  border-radius: var(--radius-md);
  background: #0f1018;
  padding: 16px;
  color: #d7ddff;
}
.terminal-placeholder p { margin-top: 8px; opacity: 0.68; font-size: 12px; line-height: 1.5; }

.timeline { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.timeline li { padding: 9px; background: var(--Highlight1); border-radius: var(--radius-sm); font-size: 12px; }
.timeline span { margin-right: 8px; opacity: 0.55; text-transform: uppercase; font-size: 10px; }
.approval-card { margin-top: 14px; padding: 12px; border: 1px dashed rgba(124,111,219,0.45); border-radius: var(--radius-md); }
.approval-card p { margin-top: 6px; font-size: 12px; opacity: 0.62; }
.mcp-states { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.mcp-states div { padding: 9px; border-radius: var(--radius-sm); background: var(--Highlight1); }
.mcp-states p, .safety-list { margin-top: 4px; font-size: 11px; line-height: 1.45; opacity: 0.62; }
.safety-list { padding-left: 18px; }
.safety-list li + li { margin-top: 4px; }

@media (max-width: 840px) {
  .workspace-grid { grid-template-columns: 1fr; }
}
</style>
