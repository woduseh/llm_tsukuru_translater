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
          :class="{ active: preset.id === activeCommandPresetId }"
          :data-risk="preset.risk"
          :aria-pressed="preset.id === activeCommandPresetId"
          @click="selectCommandPreset(preset)"
        >
          <strong>{{ preset.title }}</strong>
          <span>{{ preset.description }}</span>
          <small>{{ riskLevelLabel(preset.risk) }} · {{ preset.estimated }}</small>
        </button>

        <div v-if="activeCommandPreset" class="preset-detail" :data-risk="activeCommandPreset.risk">
          <strong>{{ activeCommandPreset.title }}</strong>
          <p>{{ activeCommandPreset.description }}</p>
          <div class="preset-badges">
            <span>{{ riskLevelLabel(activeCommandPreset.risk) }}</span>
            <span>{{ activeCommandPreset.estimated }}</span>
            <span v-if="activeCommandPreset.projectRequired">프로젝트 필요</span>
            <span v-if="activeCommandPreset.providerRequired">제공자 필요</span>
            <span v-if="activeCommandPreset.confirmationRequired">직접 실행</span>
          </div>
          <div class="preset-detail-actions">
            <button v-if="recommendedPrompt" type="button" @click="useStarterPrompt(recommendedPrompt)">
              추천 프롬프트 사용
            </button>
            <button v-if="activeCommandPreset.id === 'power-terminal'" type="button" @click="focusShellTerminal">
              셸 터미널로 이동
            </button>
          </div>
        </div>
      </div>

      <div class="panel terminal-pane" data-harness-agent-terminal-surface>
        <div class="panel-heading">
          <h2>에이전트 프리셋</h2>
          <span>미리보기 / 자동 실행 안 함</span>
        </div>
        <div class="agent-preset-tabs" data-harness-agent-cli-presets>
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
          <p class="exe-status" :data-exe-status="activeAgentPreset.executable.detectionStatus">
            {{ activeAgentPreset.executable.detectionMessage }}
          </p>
          <p>{{ activeAgentPreset.mcpMessage }}</p>
          <button type="button" :disabled="launchBusy" @click="launchKind(activeAgentPreset.terminalKind)">
            {{ launchBusy ? '시작 중…' : `${activeAgentPreset.title} 시작` }}
          </button>
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
        <div v-if="terminalSessions.length" class="workspace-tabs">
          <button
            v-for="session in terminalSessions"
            :key="session.sessionId"
            type="button"
            :class="{ active: session.sessionId === activeSessionId }"
            :data-session-state="session.state"
            @click="activeSessionId = session.sessionId"
          >
            {{ session.label }}
            <span>{{ sessionStateLabel(session.state) }}</span>
          </button>
        </div>
        <div v-else class="terminal-empty">
          <p>아직 실제 터미널 세션이 없습니다.</p>
          <button type="button" :disabled="launchBusy" @click="launchKind('codex')">Codex 시작</button>
          <button type="button" :disabled="launchBusy" @click="launchKind('claude')">Claude 시작</button>
          <button type="button" :disabled="launchBusy" @click="launchKind('shell')">셸 시작</button>
        </div>
        <p v-if="launchMessage" class="terminal-launch-message">{{ launchMessage }}</p>
        <div v-if="activeSession" class="terminal-placeholder">
          <AgentTerminalPane
            :key="activeSession.sessionId"
            :session="activeSession"
            :launch-kind="activeSession.kind"
            :title="activeSession.label"
            :compact="true"
            @launch="launchKind"
          />
        </div>
      </div>

      <div class="panel context-pane">
        <h2>환경 상태</h2>
        <ul v-if="liveStatus" class="env-status" data-harness-agent-env-status>
          <li :data-ok="liveStatus.project.selected">
            <span class="env-key">프로젝트</span>
            <span class="env-val">{{ liveStatus.project.label }}</span>
          </li>
          <li :data-ok="liveStatus.provider.ready">
            <span class="env-key">제공자</span>
            <span class="env-val">{{ liveStatus.provider.message }}</span>
          </li>
          <li :data-ok="liveStatus.terminal.available">
            <span class="env-key">터미널</span>
            <span class="env-val">{{ liveStatus.terminal.message }}</span>
          </li>
          <li :data-ok="liveStatus.mcp.serverAvailable">
            <span class="env-key">MCP</span>
            <span class="env-val">{{ liveStatus.mcp.message }}</span>
          </li>
        </ul>
        <p v-else class="env-status-loading">환경 상태 확인 중…</p>

        <div class="mcp-connect" data-harness-agent-mcp-connect>
          <div class="mcp-connect-head">
            <strong>MCP 연결 (프로젝트 파일 보호)</strong>
            <button type="button" :disabled="mcpConnectBusy" @click="prepareMcpConnection">
              {{ mcpConnectBusy ? '준비 중…' : '연결 명령 생성' }}
            </button>
          </div>
          <p v-if="!mcpConnection" class="mcp-connect-hint">프로젝트 폴더를 선택한 뒤 누르면 Codex·Claude CLI에 분석 도구를 연결합니다. 산출물은 .llm-tsukuru-agent에만 기록되고 게임 파일은 수정하지 않습니다.</p>
          <p v-else-if="!mcpConnection.ok" class="mcp-connect-error">{{ mcpConnection.reason }}</p>
          <template v-else>
            <label>Codex
              <div class="mcp-cmd"><code>{{ mcpConnection.commands?.codex }}</code><button type="button" @click="copyCommand(mcpConnection.commands?.codex ?? '')">복사</button></div>
            </label>
            <label>Claude
              <div class="mcp-cmd"><code>{{ mcpConnection.commands?.claude }}</code><button type="button" @click="copyCommand(mcpConnection.commands?.claude ?? '')">복사</button></div>
            </label>
            <p class="mcp-connect-hint">해당 CLI에서 한 번 실행하면 등록돼요.</p>
          </template>
        </div>

        <h2 class="timeline-heading">분석 준비 상태</h2>
        <ol class="timeline">
          <li v-for="item in workspace.timeline" :key="item.id" :data-status="item.status">
            <span>{{ timelineStatusLabel(item.status) }}</span>
            {{ item.title }}
          </li>
        </ol>
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
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import TitleBar from '../components/TitleBar.vue'
import AgentTerminalPane from '../components/AgentTerminalPane.vue'
import { api } from '../composables/useIpc'
import {
  createAgentWorkspaceViewModel,
  chooseActiveTerminalSessionId,
  createExecutableDetectionHint,
  deriveAgentTimeline,
  derivePresetMcpStatus,
  mcpStatusLabel,
  sessionStateLabel,
  type AgentCliPreset,
  type AgentCommandPreset,
  type CommandRiskLevel,
  type AgentStarterPrompt,
} from '../agentWorkspaceModel'
import { useTerminalSessions } from '../composables/useTerminalSessions'
import type { AgentExecutableDetectionResult } from '../../agent/agentExecutableDetection'
import type { AgentWorkspaceStatus } from '../../agent/agentWorkspaceStatus'
import type { TerminalSessionKind } from '../../types/agentWorkspace'

const workspace = reactive(createAgentWorkspaceViewModel())
const { sessions: terminalSessions, launch } = useTerminalSessions()
const activeAgentPresetId = ref<AgentCliPreset['id']>(workspace.agentPresets[0].id)
const activeCommandPresetId = ref('')
const selectedPrompt = ref('')
const liveStatus = ref<AgentWorkspaceStatus | null>(null)
const activeSessionId = ref('')
const launchBusy = ref(false)
const launchMessage = ref('')

interface McpConnectionResult {
  ok: boolean
  reason?: string
  serverPath?: string
  projectRoot?: string
  commands?: { codex: string; claude: string }
}
const mcpConnection = ref<McpConnectionResult | null>(null)
const mcpConnectBusy = ref(false)

// Maps each command preset to the starter prompt that best fits its workflow.
const COMMAND_PRESET_PROMPT: Record<string, string | undefined> = {
  'guided-translation': 'project-overview',
  'quality-review': 'quality-review',
  'repair-line-shift': 'line-shift',
  'power-terminal': undefined,
}
const activeSession = computed(() => {
  return terminalSessions.value.find((session) => session.sessionId === activeSessionId.value) ?? null
})
const activeAgentPreset = computed(() => {
  return workspace.agentPresets.find((preset) => preset.id === activeAgentPresetId.value) ?? workspace.agentPresets[0]
})
const activeCommandPreset = computed(() => {
  return workspace.presets.find((preset) => preset.id === activeCommandPresetId.value) ?? null
})
const recommendedPrompt = computed(() => {
  const preset = activeCommandPreset.value
  if (!preset) return null
  const promptId = COMMAND_PRESET_PROMPT[preset.id]
  if (!promptId) return null
  return activeAgentPreset.value.starterPrompts.find((prompt) => prompt.id === promptId) ?? null
})

function selectCommandPreset(preset: AgentCommandPreset) {
  activeCommandPresetId.value = activeCommandPresetId.value === preset.id ? '' : preset.id
}

async function focusShellTerminal() {
  const shellSession = terminalSessions.value.find((session) => session.kind === 'shell')
  if (shellSession) {
    activeSessionId.value = shellSession.sessionId
    return
  }
  await launchKind('shell')
}

let refreshing = false

onMounted(async () => {
  await refreshAll()
  window.addEventListener('focus', handleWindowFocus)
})

onUnmounted(() => {
  window.removeEventListener('focus', handleWindowFocus)
})

watch(terminalSessions, (next) => {
  activeSessionId.value = chooseActiveTerminalSessionId(next, activeSessionId.value)
}, { immediate: true })

async function launchKind(kind: TerminalSessionKind) {
  launchBusy.value = true
  launchMessage.value = ''
  try {
    const result = await launch(kind)
    if (result.session) activeSessionId.value = result.session.sessionId
    if (!result.ok) launchMessage.value = result.message || '터미널 세션을 시작하지 못했습니다.'
  } finally {
    launchBusy.value = false
  }
}

function handleWindowFocus() {
  void refreshAll()
}

async function refreshAll() {
  if (refreshing) return
  refreshing = true
  try {
    await Promise.all([detectExecutables(), refreshStatus()])
    applyLiveMcpStatus()
  } finally {
    refreshing = false
  }
}

function applyLiveMcpStatus() {
  const serverAvailable = liveStatus.value?.mcp.serverAvailable ?? false
  const projectSelected = liveStatus.value?.project.selected ?? false
  for (const preset of workspace.agentPresets) {
    preset.mcpStatus = derivePresetMcpStatus(preset.id, {
      serverAvailable,
      executableAvailable: preset.executable.detectionStatus === 'available',
      projectSelected,
    })
  }
}

async function refreshStatus() {
  try {
    const status = (await api.invoke('getAgentWorkspaceStatus')) as AgentWorkspaceStatus | undefined
    if (!status) return
    liveStatus.value = status
    workspace.timeline = deriveAgentTimeline({
      projectSelected: status.project.selected,
      mcpServerAvailable: status.mcp.serverAvailable,
    })
  } catch {
    // Best-effort; the default (waiting) timeline stays in place on failure.
  }
}

async function detectExecutables() {
  try {
    const payload = workspace.agentPresets.map((preset) => ({
      id: preset.id,
      executableNames: preset.executable.executableNames,
    }))
    const result = (await api.invoke('detectAgentExecutables', payload)) as AgentExecutableDetectionResult | undefined
    if (!result || !Array.isArray(result.results)) return
    for (const entry of result.results) {
      const preset = workspace.agentPresets.find((candidate) => candidate.id === entry.id)
      if (!preset) continue
      preset.executable = createExecutableDetectionHint(preset.executable.executableNames, entry.status)
    }
  } catch {
    // Detection is best-effort; leave the default "not yet probed" hint on failure.
  }
}

function openSettings() {
  api.send('settings')
}

async function prepareMcpConnection() {
  mcpConnectBusy.value = true
  try {
    mcpConnection.value = (await api.invoke('prepareAgentMcpConnection')) as McpConnectionResult
  } catch {
    mcpConnection.value = { ok: false, reason: '연결 명령을 생성하지 못했습니다.' }
  } finally {
    mcpConnectBusy.value = false
  }
}

async function copyCommand(text: string) {
  if (text && navigator.clipboard) await navigator.clipboard.writeText(text)
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
  padding: 16px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.workspace-hero {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(124,111,219,0.18), rgba(42,43,61,0.72));
  border: var(--border);
  border-radius: var(--radius-lg);
}

.eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 1.4px; opacity: 0.5; }
.workspace-hero h1 { margin: 2px 0; font-size: 20px; }
.workspace-hero p:last-child { opacity: 0.68; font-size: 12px; }

/* Base layout is tuned for the app's fixed 800px-wide window: two info
   columns up top, the agent/terminal section full-width below. */
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    "navigator context"
    "terminal terminal";
  gap: 12px;
  min-height: 0;
  /* Do not let the flex parent compress the grid below its content height;
     otherwise the auto row tracks shrink and the taller column overflows
     into the row below it (panels overlap). The parent scrolls instead. */
  flex-shrink: 0;
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
.terminal-pane { display: flex; flex-direction: column; min-height: 0; }
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
  cursor: pointer;
  min-width: 0;
}
.preset:hover { border-color: rgba(124,111,219,0.5); }
.preset.active { border-color: rgba(124,111,219,0.7); background: rgba(124,111,219,0.16); }
.preset strong, .preset span, .preset small { overflow-wrap: anywhere; }

.preset-detail {
  margin-top: 6px;
  padding: 11px;
  border: 1px solid rgba(124,111,219,0.4);
  border-radius: var(--radius-md);
  background: rgba(124,111,219,0.08);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.preset-detail strong { font-size: 13px; }
.preset-detail p { font-size: 11px; opacity: 0.85; line-height: 1.4; overflow-wrap: anywhere; }
.preset-badges { display: flex; flex-wrap: wrap; gap: 5px; }
.preset-badges span {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  opacity: 0.9;
}
.preset-detail-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.preset-detail-actions button {
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 9px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
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
.command-preview button,
.terminal-empty button {
  background: var(--Highlight1);
  color: var(--mainColor);
  border: var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-family: inherit;
  cursor: pointer;
}
.exe-status { position: relative; padding-left: 14px; }
.exe-status::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8a8f9c;
}
.exe-status[data-exe-status="available"]::before { background: #5fd08a; }
.exe-status[data-exe-status="missing"]::before { background: #ff9c9c; }
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
.terminal-empty {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 14px;
  border: 1px dashed rgba(124,111,219,0.4);
  border-radius: var(--radius-md);
}
.terminal-empty p { flex: 1 1 100%; opacity: 0.8; }
.terminal-launch-message { margin: 8px 0; color: #ffb3b3; font-size: 12px; }

.terminal-placeholder {
  flex: 1;
  height: 300px;
  min-height: 300px;
  border-radius: var(--radius-md);
  background: #0f1018;
  padding: 10px;
  color: #d7ddff;
  min-width: 0;
  overflow: hidden;
}
/* Let the embedded terminal flex within the placeholder instead of forcing
   its own (taller) min-height, which would overflow and clip the toolbar. */
.terminal-placeholder :deep(.terminal-host) { min-height: 0; }
.terminal-placeholder p { margin-top: 8px; opacity: 0.82; font-size: 12px; line-height: 1.5; }

.env-status { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.env-status li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 7px 9px 7px 20px;
  position: relative;
  background: var(--Highlight1);
  border-radius: var(--radius-sm);
  font-size: 11px;
  min-width: 0;
}
.env-status li::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 11px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff9c9c;
}
.env-status li[data-ok="true"]::before { background: #5fd08a; }
.env-key { flex: 0 0 auto; font-weight: 700; opacity: 0.85; }
.env-val { flex: 1 1 auto; opacity: 0.82; overflow-wrap: anywhere; }
.env-status-loading { font-size: 11px; opacity: 0.7; }
.timeline-heading { margin-top: 14px; }

.timeline { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.timeline li { padding: 9px; background: var(--Highlight1); border-radius: var(--radius-sm); font-size: 12px; }
.timeline span { margin-right: 8px; opacity: 0.78; font-size: 10px; }
.mcp-states { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.mcp-states div { padding: 9px; border-radius: var(--radius-sm); background: var(--Highlight1); }
.mcp-states p, .safety-list { margin-top: 4px; font-size: 11px; line-height: 1.45; opacity: 0.82; }
.safety-list { padding-left: 18px; }
.safety-list li + li { margin-top: 4px; }

/* Roomy three-column layout for wide windows (only if the window is ever
   made resizable); never triggers in the default 800px window. */
@media (min-width: 1200px) {
  .workspace-grid {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.45fr) minmax(0, 0.95fr);
    grid-template-areas: "navigator terminal context";
  }
  .terminal-placeholder {
    height: clamp(360px, 48vh, 560px);
    min-height: 0;
  }
}

/* Very narrow windows: stack everything in a single column. */
@media (max-width: 680px) {
  .workspace-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .workspace-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "navigator"
      "context"
      "terminal";
  }
}
.mcp-connect {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid rgba(124,111,219,0.4);
  border-radius: var(--radius-md);
  background: rgba(124,111,219,0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mcp-connect-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.mcp-connect-head strong { font-size: 13px; }
.mcp-connect-head button {
  background: var(--Highlight1); color: var(--mainColor); border: var(--border);
  border-radius: var(--radius-sm); padding: 6px 10px; font-size: 11px; font-family: inherit; cursor: pointer;
}
.mcp-connect-head button:disabled { opacity: 0.5; cursor: default; }
.mcp-connect-hint { font-size: 11px; opacity: 0.8; line-height: 1.4; overflow-wrap: anywhere; }
.mcp-connect-error { font-size: 11px; color: #ff9c9c; }
.mcp-connect label { font-size: 10px; opacity: 0.7; display: flex; flex-direction: column; gap: 4px; }
.mcp-cmd { display: flex; gap: 6px; align-items: stretch; min-width: 0; }
.mcp-cmd code {
  flex: 1; min-width: 0; background: #0f1018; color: #d7ddff; border-radius: var(--radius-sm);
  padding: 7px 9px; font-family: Consolas, 'Courier New', monospace; font-size: 11px;
  overflow-wrap: anywhere; white-space: pre-wrap;
}
.mcp-cmd button {
  background: var(--Highlight1); color: var(--mainColor); border: var(--border);
  border-radius: var(--radius-sm); padding: 0 10px; font-size: 11px; font-family: inherit; cursor: pointer; white-space: nowrap;
}

</style>
