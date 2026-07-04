import type {
  TerminalEvent,
  TerminalEventKind,
  TerminalSessionKind,
  TerminalSessionState,
  TerminalSessionSummary,
} from '../types/agentWorkspace'
import { MANAGED_TERMINAL_PRESETS, createTerminalCommandPreview } from '../terminalCommandPresets'

export const AGENT_WORKSPACE_ROUTE = '/agent-workspace'

export type AgentTerminalKind = TerminalSessionKind
export type AgentTerminalSessionState = TerminalSessionState
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

export interface AgentCommandPreset {
  id: string
  title: string
  description: string
  risk: CommandRiskLevel
  confirmationRequired: boolean
  projectRequired: boolean
  providerRequired: boolean
  estimated: string
}

export interface McpStatusCard {
  status: McpConnectionStatus
  label: string
  description: string
}

export type TimelineStatus = 'ready' | 'waiting' | 'mocked'

export interface AgentTimelineStep {
  id: string
  title: string
  status: TimelineStatus
}

export interface AgentWorkspaceLiveSignals {
  projectSelected: boolean
  mcpServerAvailable: boolean
}

export interface AgentWorkspaceViewModel {
  route: string
  title: string
  subtitle: string
  presets: AgentCommandPreset[]
  agentPresets: AgentCliPreset[]
  mcpStatusCards: McpStatusCard[]
  safetyGuidance: string[]
  timeline: AgentTimelineStep[]
}

export const SESSION_STATE_LABELS: Record<AgentTerminalSessionState, string> = {
  created: '생성됨',
  starting: '시작 중',
  running: '실행 중',
  idle: '대기 중',
  exited: '종료됨',
  failed: '실패',
  killed: '중지됨',
  unavailable: '사용 불가',
  reconnecting: '다시 연결 중',
}

export const TERMINAL_EVENT_LABELS: Record<TerminalEventKind, string> = {
  stdout: 'stdout',
  stderr: 'stderr',
  exit: 'exit',
  started: 'started',
  error: 'error',
  truncated: 'truncated',
}

export const MCP_STATUS_LABELS: Record<McpConnectionStatus, string> = {
  enabled: 'MCP 연결 준비됨',
  degraded: 'MCP 준비 필요',
  disconnected: 'MCP 사용 안 함',
}

export function sessionStateLabel(state: AgentTerminalSessionState): string {
  return SESSION_STATE_LABELS[state]
}

export function mergeTerminalSession(
  sessions: TerminalSessionSummary[],
  next: TerminalSessionSummary,
): TerminalSessionSummary[] {
  const index = sessions.findIndex((session) => session.sessionId === next.sessionId)
  if (index < 0) return [...sessions, next]
  return sessions.map((session, candidateIndex) => (candidateIndex === index ? next : session))
}

export function chooseActiveTerminalSessionId(
  sessions: TerminalSessionSummary[],
  currentSessionId = '',
): string {
  if (sessions.some((session) => session.sessionId === currentSessionId)) return currentSessionId
  const active = [...sessions].reverse().find((session) => ['starting', 'running', 'idle', 'reconnecting'].includes(session.state))
  return active?.sessionId ?? sessions[sessions.length - 1]?.sessionId ?? ''
}

export function applyTerminalEvent(session: TerminalSessionSummary, event: TerminalEvent): TerminalSessionSummary {
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
    latestSequence: Math.max(session.latestSequence, event.sequence),
    exitCode: event.exitCode ?? session.exitCode,
  }
}

export function shouldPersistTerminalOutput(session: TerminalSessionSummary): boolean {
  return session.persistOutput && session.outputRetention === 'persisted'
}

export const AGENT_COMMAND_PRESETS: AgentCommandPreset[] = [
  {
    id: 'guided-translation',
    title: '번역 준비 점검',
    description: '프로젝트 구조와 번역 입력을 분석한 뒤 앱에서 번역할 준비가 되었는지 확인합니다.',
    risk: 'safe',
    confirmationRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '설정 5분',
  },
  {
    id: 'quality-review',
    title: '번역 품질 점검',
    description: '품질과 줄 정렬 위험을 분석하고 전용 작업공간에 결과를 기록합니다.',
    risk: 'review',
    confirmationRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '1-3분',
  },
  {
    id: 'repair-line-shift',
    title: '줄 정렬 문제 찾기',
    description: '추출 텍스트의 줄 밀림과 메타데이터 불일치를 안전하게 점검합니다.',
    risk: 'review',
    confirmationRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '2-4분',
  },
  {
    id: 'power-terminal',
    title: '고급 터미널',
    description: '프로젝트 폴더에서 내장 터미널을 엽니다. 사용자 명령은 항상 직접 확인해야 합니다.',
    risk: 'dangerous',
    confirmationRequired: true,
    projectRequired: false,
    providerRequired: false,
    estimated: '즉시',
  },
]

const DEFAULT_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: 'project-overview',
    title: '프로젝트 개요',
    action: 'send',
    prompt: 'project.context_snapshot과 project.translation_inventory로 현재 프로젝트 구조와 번역 입력을 간결하게 요약해줘. 게임 파일을 수정하지 말고 전체 원문 덤프는 피해야 해.',
  },
  {
    id: 'quality-review',
    title: '품질 점검',
    action: 'send',
    prompt: '현재 번역을 점검해. 필요하면 QA 산출물을 프로젝트 전용 작업공간에 기록해도 되지만 게임과 번역 원본은 수정하지 마. 줄 번호, 구분선, 제어 코드, 빈 줄을 확인하고 전체 원문 덤프는 피해야 해.',
  },
  {
    id: 'line-shift',
    title: '줄 정렬 진단',
    action: 'send',
    prompt: 'alignment 도구로 원문과 번역문의 줄 수, 구분선, 빈 줄, 제어 코드 차이를 진단해줘. 분석 산출물은 .llm-tsukuru-agent에만 기록하고 원본 파일은 수정하지 마.',
  },
  {
    id: 'provider-setup',
    title: '제공자 설정 안내',
    action: 'copy',
    prompt: 'provider.list로 지원 제공자를 설명하고, 실제 자격 증명과 준비 상태는 앱 설정 화면에서 확인하도록 안내해줘. 인증 정보는 채팅이나 터미널에 요청하지 마.',
  },
]

export const AGENT_CLI_PRESETS: AgentCliPreset[] = [
  createAgentCliPreset({
    id: 'codex',
    title: MANAGED_TERMINAL_PRESETS.codex.title,
    description: MANAGED_TERMINAL_PRESETS.codex.description,
    terminalKind: 'codex',
    executableNames: MANAGED_TERMINAL_PRESETS.codex.executableNames,
    command: { executable: MANAGED_TERMINAL_PRESETS.codex.executable, args: MANAGED_TERMINAL_PRESETS.codex.args },
    mcpStatus: 'degraded',
    mcpMessage: MANAGED_TERMINAL_PRESETS.codex.mcpMessage,
  }),
  createAgentCliPreset({
    id: 'claude',
    title: MANAGED_TERMINAL_PRESETS.claude.title,
    description: MANAGED_TERMINAL_PRESETS.claude.description,
    terminalKind: 'claude',
    executableNames: MANAGED_TERMINAL_PRESETS.claude.executableNames,
    command: { executable: MANAGED_TERMINAL_PRESETS.claude.executable, args: MANAGED_TERMINAL_PRESETS.claude.args },
    mcpStatus: 'degraded',
    mcpMessage: MANAGED_TERMINAL_PRESETS.claude.mcpMessage,
  }),
  createAgentCliPreset({
    id: 'generic',
    title: '일반 셸',
    description: 'PowerShell 같은 일반 터미널에서 직접 명령을 실행합니다. MCP 연결은 기본으로 제공하지 않습니다.',
    terminalKind: 'shell',
    executableNames: ['powershell.exe', 'pwsh.exe', 'cmd.exe'],
    command: { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] },
    mcpStatus: 'disconnected',
    mcpMessage: '복사한 프롬프트를 수동으로 사용하세요. 일반 셸에는 MCP 세션을 자동 연결하지 않습니다.',
  }),
]

export const AGENT_SAFETY_GUIDANCE = [
  'MCP 분석 산출물은 .llm-tsukuru-agent 작업공간에만 기록합니다.',
  '실제 번역과 적용은 앱 화면에서 사용자가 직접 실행합니다.',
  '전체 원문 덤프나 비밀값을 에이전트, 로그, 프롬프트, 터미널 출력에 붙여넣지 않습니다.',
  '줄 번호 정렬, 구분선, 제어 코드, 이스케이프 시퀀스, 빈 줄을 보존합니다.',
]

export const MCP_STATUS_CARDS: McpStatusCard[] = [
  {
    status: 'enabled',
    label: MCP_STATUS_LABELS.enabled,
    description: 'CLI 등록 명령을 만들 수 있습니다. 등록 후 프로젝트 분석과 전용 작업공간 QA 기록을 사용할 수 있습니다.',
  },
  {
    status: 'degraded',
    label: MCP_STATUS_LABELS.degraded,
    description: '프로젝트, 서버 번들, CLI 실행 파일 중 일부가 준비되지 않았습니다.',
  },
  {
    status: 'disconnected',
    label: MCP_STATUS_LABELS.disconnected,
    description: '시작 프롬프트와 설정 도움말만 표시하며 도구 호출은 시도하지 않습니다.',
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
      ? '실행 파일 감지는 시작 시 수행됩니다. 아직 PATH 조회를 하지 않았습니다.'
      : status === 'available'
        ? '실행 파일을 사용할 수 있습니다.'
        : '실행 파일을 찾지 못했습니다. 프롬프트를 복사하거나 CLI를 먼저 설정하세요.',
  }
}

export function createCommandPreview(executable: string, args: string[]): string {
  return createTerminalCommandPreview(executable, args)
}

export function mcpStatusLabel(status: McpConnectionStatus): string {
  return MCP_STATUS_LABELS[status]
}

export function providerNotReadyGuidance(): string {
  return '번역 제공자가 준비되지 않았습니다. 설정 화면에서만 인증 정보를 입력한 뒤 번역 전 준비 상태를 다시 확인하세요.'
}

export function noProjectGuidance(): string {
  return '선택된 프로젝트가 없습니다. 에이전트 작업을 실행하기 전에 RPG Maker MV/MZ 또는 Wolf RPG 프로젝트를 선택하세요.'
}

/**
 * Derive analysis readiness from the selected project and bundled MCP server.
 */
export function deriveAgentTimeline(signals: AgentWorkspaceLiveSignals): AgentTimelineStep[] {
  const ready = (condition: boolean): TimelineStatus => (condition ? 'ready' : 'waiting')
  const projectReady = signals.projectSelected
  const analysisReady = signals.projectSelected && signals.mcpServerAvailable
  return [
    { id: 'project-selected', title: '프로젝트 선택', status: ready(projectReady) },
    { id: 'mcp-ready', title: 'MCP 준비', status: ready(analysisReady) },
    { id: 'project-analysis', title: '프로젝트 분석', status: ready(analysisReady) },
    { id: 'quality-review', title: '품질 점검', status: ready(analysisReady) },
  ]
}

export interface AgentMcpSignals {
  /** The bundled offline MCP server is available. */
  serverAvailable: boolean
  /** The preset's CLI executable was found on PATH. */
  executableAvailable: boolean
  /** A trusted project root is currently selected. */
  projectSelected: boolean
}

/**
 * Derive whether the app can prepare an MCP registration command. This does
 * not claim that an external CLI has executed the command or connected.
 */
export function derivePresetMcpStatus(
  presetId: AgentCliPreset['id'],
  signals: AgentMcpSignals,
): McpConnectionStatus {
  if (presetId === 'generic') return 'disconnected'
  if (!signals.serverAvailable) return 'disconnected'
  if (signals.executableAvailable && signals.projectSelected) return 'enabled'
  return 'degraded'
}

export function createAgentWorkspaceViewModel(): AgentWorkspaceViewModel {
  return {
    route: AGENT_WORKSPACE_ROUTE,
    title: 'AI 작업공간',
    subtitle: '외부 CLI, 프로젝트 분석 도구, 내장 터미널을 한곳에서 다루는 작업 공간입니다.',
    presets: AGENT_COMMAND_PRESETS,
    agentPresets: AGENT_CLI_PRESETS,
    mcpStatusCards: MCP_STATUS_CARDS,
    safetyGuidance: AGENT_SAFETY_GUIDANCE,
    timeline: deriveAgentTimeline({ projectSelected: false, mcpServerAvailable: false }),
  }
}
