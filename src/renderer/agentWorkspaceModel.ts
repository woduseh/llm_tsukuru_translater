import type { AgentEvent } from '../agent/eventBus'
import type { TerminalEvent, TerminalEventKind, TerminalSessionKind, TerminalSessionState } from '../types/agentWorkspace'

export const AGENT_WORKSPACE_ROUTE = '/agent-workspace'

export type AgentTerminalKind = TerminalSessionKind
export type AgentTerminalSessionState = TerminalSessionState
export type TerminalOutputRetention = 'ephemeral' | 'persisted'
export type CommandRiskLevel = 'safe' | 'review' | 'write' | 'dangerous'
export type AgentExecutableStatus = 'unknown' | 'available' | 'missing'
export type McpConnectionStatus = 'enabled' | 'degraded' | 'disconnected'
export type StarterPromptAction = 'copy' | 'send'

export interface AgentExecutableHint {
  executableNames: string[]
  detectionStatus: AgentExecutableStatus
  detectionMessage: string
}

export interface AgentStarterPrompt {
  id: string
  title: string
  action: StarterPromptAction
  prompt: string
}

export interface AgentCliPreset {
  id: 'codex' | 'claude' | 'generic'
  title: string
  description: string
  terminalKind: AgentTerminalKind
  executable: AgentExecutableHint
  command: {
    executable: string
    args: string[]
  }
  commandPreview: string
  starterPrompts: AgentStarterPrompt[]
  mcpStatus: McpConnectionStatus
  mcpMessage: string
}

export interface AgentTerminalSession {
  id: string
  label: string
  kind: AgentTerminalKind
  cwdLabel: string
  state: AgentTerminalSessionState
  outputRetention: TerminalOutputRetention
  persistOutput: boolean
  latestEvent?: TerminalEvent
  exitCode?: number
}

export interface AgentTerminalDrawerState {
  isOpen: boolean
  activeSessionId: string
  sessions: AgentTerminalSession[]
  activity: AgentEvent[]
}

export interface AgentCommandPreset {
  id: string
  title: string
  description: string
  risk: CommandRiskLevel
  approvalRequired: boolean
  projectRequired: boolean
  providerRequired: boolean
  estimated: string
}

export interface McpStatusCard {
  status: McpConnectionStatus
  label: string
  description: string
}

export interface AgentWorkspaceViewModel {
  route: string
  title: string
  subtitle: string
  presets: AgentCommandPreset[]
  agentPresets: AgentCliPreset[]
  mcpStatusCards: McpStatusCard[]
  safetyGuidance: string[]
  drawer: AgentTerminalDrawerState
  timeline: Array<{ id: string; title: string; status: 'ready' | 'waiting' | 'mocked' }>
}

export const SESSION_STATE_LABELS: Record<AgentTerminalSessionState, string> = {
  created: 'Created',
  starting: 'Starting',
  running: 'Running',
  idle: 'Idle',
  exited: 'Exited',
  failed: 'Failed',
  killed: 'Killed',
}

export const TERMINAL_EVENT_LABELS: Record<TerminalEventKind, string> = {
  stdout: 'stdout',
  stderr: 'stderr',
  exit: 'exit',
  started: 'started',
  error: 'error',
}

export const MCP_STATUS_LABELS: Record<McpConnectionStatus, string> = {
  enabled: 'MCP enabled',
  degraded: 'MCP degraded',
  disconnected: 'MCP disconnected',
}

export function createDefaultTerminalSessions(cwdLabel = 'Project not selected'): AgentTerminalSession[] {
  return [
    createTerminalSession('codex', 'Codex', 'codex', cwdLabel),
    createTerminalSession('claude', 'Claude', 'claude', cwdLabel),
    createTerminalSession('shell', 'Shell', 'shell', cwdLabel),
  ]
}

export function createTerminalSession(
  id: string,
  label: string,
  kind: AgentTerminalKind,
  cwdLabel: string,
): AgentTerminalSession {
  return {
    id,
    label,
    kind,
    cwdLabel,
    state: 'created',
    outputRetention: 'ephemeral',
    persistOutput: false,
  }
}

export function createAgentTerminalDrawerState(cwdLabel?: string): AgentTerminalDrawerState {
  const sessions = createDefaultTerminalSessions(cwdLabel)
  return {
    isOpen: false,
    activeSessionId: sessions[0].id,
    sessions,
    activity: [],
  }
}

export function setTerminalDrawerOpen(state: AgentTerminalDrawerState, isOpen: boolean): AgentTerminalDrawerState {
  return { ...state, isOpen }
}

export function sessionStateLabel(state: AgentTerminalSessionState): string {
  return SESSION_STATE_LABELS[state]
}

export function updateTerminalSessionState(
  session: AgentTerminalSession,
  nextState: AgentTerminalSessionState,
  exitCode?: number,
): AgentTerminalSession {
  return { ...session, state: nextState, exitCode }
}

export function applyTerminalEvent(session: AgentTerminalSession, event: TerminalEvent): AgentTerminalSession {
  const nextState = event.kind === 'started'
    ? 'running'
    : event.kind === 'exit'
      ? 'exited'
      : event.kind === 'error'
        ? 'failed'
        : session.state

  return {
    ...session,
    state: nextState,
    latestEvent: event,
    exitCode: event.exitCode ?? session.exitCode,
  }
}

export function shouldPersistTerminalOutput(session: AgentTerminalSession): boolean {
  return session.persistOutput && session.outputRetention === 'persisted'
}

export const AGENT_COMMAND_PRESETS: AgentCommandPreset[] = [
  {
    id: 'guided-translation',
    title: 'Guided translation wizard',
    description: 'Walk through extract, translate, compare, verify, and safe apply checkpoints.',
    risk: 'safe',
    approvalRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '5 min setup',
  },
  {
    id: 'quality-review',
    title: 'Review translated files',
    description: 'Use read-only AgentService contracts to summarize likely quality and alignment issues.',
    risk: 'review',
    approvalRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '1-3 min',
  },
  {
    id: 'repair-line-shift',
    title: 'Find line alignment problems',
    description: 'Prepare a safe, mocked inspection flow for shifted extracted text lines.',
    risk: 'review',
    approvalRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '2-4 min',
  },
  {
    id: 'safe-apply-plan',
    title: 'Create safe apply plan',
    description: 'Draft preview artifacts before any future write operation is allowed.',
    risk: 'write',
    approvalRequired: true,
    projectRequired: true,
    providerRequired: false,
    estimated: '3-5 min',
  },
  {
    id: 'power-terminal',
    title: 'Power terminal',
    description: 'Open the mocked terminal pane. Privileged command execution is intentionally disabled.',
    risk: 'dangerous',
    approvalRequired: true,
    projectRequired: false,
    providerRequired: false,
    estimated: 'scaffold only',
  },
]

const DEFAULT_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: 'first-translation',
    title: 'First translation',
    action: 'send',
    prompt: 'Guide me through a safe first translation. Start with read-only project context, provider readiness, a small batch, quality review, compare, and apply preview. Do not run destructive commands.',
  },
  {
    id: 'quality-review',
    title: 'Quality review',
    action: 'send',
    prompt: 'Review the current translation safely. Use read-only MCP summaries, preserve line numbers, separators, control codes, and empty lines, and avoid full source dumps.',
  },
  {
    id: 'safe-apply',
    title: 'Safe apply plan',
    action: 'copy',
    prompt: 'Create a safe apply plan with a preview artifact and explicit approval gate. Stop if .txt line counts or .extracteddata alignment look suspicious.',
  },
  {
    id: 'recovery',
    title: 'Failed translation recovery',
    action: 'copy',
    prompt: 'Help recover a failed translation by checking sanitized provider readiness and bounded failure artifacts. Retry only failed batches and never expose credentials.',
  },
]

export const AGENT_CLI_PRESETS: AgentCliPreset[] = [
  createAgentCliPreset({
    id: 'codex',
    title: 'Codex CLI',
    description: 'Use Codex with this project and the read-only MCP guide context.',
    terminalKind: 'codex',
    executableNames: ['codex.cmd', 'codex.exe', 'codex'],
    command: { executable: 'codex', args: ['--cwd', '<project>', '--ask-for-approval'] },
    mcpStatus: 'degraded',
    mcpMessage: 'Read-only MCP helpers are scaffolded; executable detection and spawning are not active yet.',
  }),
  createAgentCliPreset({
    id: 'claude',
    title: 'Claude CLI',
    description: 'Use Claude with safe starter prompts and MCP read-only context.',
    terminalKind: 'claude',
    executableNames: ['claude.cmd', 'claude.exe', 'claude'],
    command: { executable: 'claude', args: ['--permission-mode', 'plan', '<project>'] },
    mcpStatus: 'degraded',
    mcpMessage: 'Claude preset is preview-only until PTY/MCP connection plumbing is enabled.',
  }),
  createAgentCliPreset({
    id: 'generic',
    title: 'Generic shell agent',
    description: 'Copy starter prompts into any external assistant without granting write access.',
    terminalKind: 'shell',
    executableNames: ['powershell.exe', 'pwsh.exe', 'cmd.exe'],
    command: { executable: 'powershell.exe', args: ['-NoExit', '-Command', 'Write-Host "Agent prompt preview only"'] },
    mcpStatus: 'disconnected',
    mcpMessage: 'Use copied prompts manually; no MCP session is connected from this preset.',
  }),
]

export const AGENT_SAFETY_GUIDANCE = [
  'Preview before run/apply and require approval before any future write.',
  'Do not paste full source dumps or secrets into agents, logs, prompts, or terminal output.',
  'Preserve line-number alignment, separators, control codes, escape sequences, and empty lines.',
]

export const MCP_STATUS_CARDS: McpStatusCard[] = [
  {
    status: 'enabled',
    label: MCP_STATUS_LABELS.enabled,
    description: 'Read-only tools are available and provider/project guidance can be shown.',
  },
  {
    status: 'degraded',
    label: MCP_STATUS_LABELS.degraded,
    description: 'Guidance and command previews work, but a provider, project, or executable is not ready.',
  },
  {
    status: 'disconnected',
    label: MCP_STATUS_LABELS.disconnected,
    description: 'Show copied starter prompts and setup help only; do not attempt tool calls.',
  },
]

export function createAgentCliPreset(options: {
  id: AgentCliPreset['id']
  title: string
  description: string
  terminalKind: AgentTerminalKind
  executableNames: string[]
  command: { executable: string; args: string[] }
  mcpStatus: McpConnectionStatus
  mcpMessage: string
}): AgentCliPreset {
  return {
    id: options.id,
    title: options.title,
    description: options.description,
    terminalKind: options.terminalKind,
    executable: createExecutableDetectionHint(options.executableNames),
    command: options.command,
    commandPreview: createCommandPreview(options.command.executable, options.command.args),
    starterPrompts: DEFAULT_STARTER_PROMPTS,
    mcpStatus: options.mcpStatus,
    mcpMessage: options.mcpMessage,
  }
}

export function createExecutableDetectionHint(executableNames: string[], status: AgentExecutableStatus = 'unknown'): AgentExecutableHint {
  return {
    executableNames,
    detectionStatus: status,
    detectionMessage: status === 'unknown'
      ? 'Executable detection is scaffolded; no PATH lookup has been performed.'
      : status === 'available'
        ? 'Executable is available.'
        : 'Executable was not found. Use copy prompts or configure the CLI first.',
  }
}

export function createCommandPreview(executable: string, args: string[]): string {
  return [quoteCommandPart(executable), ...args.map(quoteCommandPart)].join(' ')
}

export function mcpStatusLabel(status: McpConnectionStatus): string {
  return MCP_STATUS_LABELS[status]
}

export function providerNotReadyGuidance(): string {
  return 'Provider is not ready. Open settings, configure credentials there only, then re-check readiness before translation.'
}

export function noProjectGuidance(): string {
  return 'No project is selected. Choose an RPG Maker MV/MZ or Wolf RPG project before running agent workflows.'
}

export function createAgentWorkspaceViewModel(cwdLabel?: string): AgentWorkspaceViewModel {
  return {
    route: AGENT_WORKSPACE_ROUTE,
    title: 'AI 작업공간',
    subtitle: 'Agent Workspace scaffold: terminal, sessions, activity, approvals, and command presets.',
    presets: AGENT_COMMAND_PRESETS,
    agentPresets: AGENT_CLI_PRESETS,
    mcpStatusCards: MCP_STATUS_CARDS,
    safetyGuidance: AGENT_SAFETY_GUIDANCE,
    drawer: createAgentTerminalDrawerState(cwdLabel),
    timeline: [
      { id: 'project-selected', title: 'Project selected', status: 'waiting' },
      { id: 'extract-preview', title: 'Extract preview', status: 'mocked' },
      { id: 'quality-review', title: 'Quality review', status: 'mocked' },
      { id: 'approval-gate', title: 'Approval gate', status: 'ready' },
      { id: 'safe-apply', title: 'Safe apply', status: 'waiting' },
    ],
  }
}

function quoteCommandPart(part: string): string {
  return /[\s"]/g.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part
}

export function createMockTerminalEvent(
  sessionId: string,
  sequence: number,
  kind: TerminalEventKind,
  data?: string,
): TerminalEvent {
  const event: TerminalEvent = {
    schemaVersion: 1,
    sessionId,
    sequence,
    kind,
    timestamp: new Date().toISOString(),
    data,
    redacted: true,
  }
  if (kind === 'exit') event.exitCode = 0
  return event
}
