import type { AgentEvent } from '../agent/eventBus'
import type { TerminalEvent, TerminalEventKind, TerminalSessionKind, TerminalSessionState } from '../types/agentWorkspace'
import { MANAGED_TERMINAL_PRESETS, createTerminalCommandPreview } from '../terminalCommandPresets'

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
  enabled: 'MCP 연결됨',
  degraded: 'MCP 제한 모드',
  disconnected: 'MCP 연결 안 됨',
}

export function createDefaultTerminalSessions(cwdLabel = '프로젝트 미선택'): AgentTerminalSession[] {
  return [
    createTerminalSession('codex', 'Codex', 'codex', cwdLabel),
    createTerminalSession('claude', 'Claude', 'claude', cwdLabel),
    createTerminalSession('shell', '셸', 'shell', cwdLabel),
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
    title: '안전 번역 마법사',
    description: '추출, 번역, 비교, 검증, 안전 적용 단계를 순서대로 확인합니다.',
    risk: 'safe',
    approvalRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '설정 5분',
  },
  {
    id: 'quality-review',
    title: '번역 품질 점검',
    description: '읽기 전용 점검으로 품질, 줄 정렬, 적용 위험을 요약합니다.',
    risk: 'review',
    approvalRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '1-3분',
  },
  {
    id: 'repair-line-shift',
    title: '줄 정렬 문제 찾기',
    description: '추출 텍스트의 줄 밀림과 메타데이터 불일치를 안전하게 점검합니다.',
    risk: 'review',
    approvalRequired: false,
    projectRequired: true,
    providerRequired: false,
    estimated: '2-4분',
  },
  {
    id: 'safe-apply-plan',
    title: '안전 적용 계획 만들기',
    description: '쓰기 작업 전 미리보기와 승인 단계를 먼저 준비합니다.',
    risk: 'write',
    approvalRequired: true,
    projectRequired: true,
    providerRequired: false,
    estimated: '3-5분',
  },
  {
    id: 'power-terminal',
    title: '고급 터미널',
    description: '프로젝트 폴더에서 내장 터미널을 엽니다. 사용자 명령은 항상 직접 확인해야 합니다.',
    risk: 'dangerous',
    approvalRequired: true,
    projectRequired: false,
    providerRequired: false,
    estimated: '즉시',
  },
]

const DEFAULT_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: 'first-translation',
    title: '첫 번역',
    action: 'send',
    prompt: '안전한 첫 번역을 단계별로 도와줘. 먼저 읽기 전용 프로젝트 컨텍스트, 제공자 준비 상태, 작은 배치, 품질 점검, 비교, 적용 미리보기를 확인해. 파괴적인 명령은 실행하지 마.',
  },
  {
    id: 'quality-review',
    title: '품질 점검',
    action: 'send',
    prompt: '현재 번역을 안전하게 점검해. 읽기 전용 MCP 요약만 사용하고 줄 번호, 구분선, 제어 코드, 빈 줄을 보존해. 전체 원문 덤프는 피해야 해.',
  },
  {
    id: 'safe-apply',
    title: '안전 적용 계획',
    action: 'copy',
    prompt: '미리보기 산출물과 명시적 승인 단계를 포함한 안전 적용 계획을 만들어줘. .txt 줄 수나 .extracteddata 정렬이 의심스러우면 중단해.',
  },
  {
    id: 'recovery',
    title: '실패한 번역 복구',
    action: 'copy',
    prompt: '정제된 제공자 준비 상태와 제한된 실패 산출물을 확인해 실패한 번역을 복구해줘. 실패한 배치만 재시도하고 인증 정보는 절대 노출하지 마.',
  },
]

export const AGENT_CLI_PRESETS: AgentCliPreset[] = [
  createAgentCliPreset({
    id: 'codex',
    title: MANAGED_TERMINAL_PRESETS.codex.title,
    description: MANAGED_TERMINAL_PRESETS.codex.description,
    terminalKind: 'codex',
    executableNames: MANAGED_TERMINAL_PRESETS.codex.executableNames,
    command: { executable: 'codex', args: MANAGED_TERMINAL_PRESETS.codex.args },
    mcpStatus: 'degraded',
    mcpMessage: MANAGED_TERMINAL_PRESETS.codex.mcpMessage,
  }),
  createAgentCliPreset({
    id: 'claude',
    title: MANAGED_TERMINAL_PRESETS.claude.title,
    description: MANAGED_TERMINAL_PRESETS.claude.description,
    terminalKind: 'claude',
    executableNames: MANAGED_TERMINAL_PRESETS.claude.executableNames,
    command: { executable: 'claude', args: MANAGED_TERMINAL_PRESETS.claude.args },
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
  '실행/적용 전에는 반드시 미리보기와 승인 단계를 거칩니다.',
  '전체 원문 덤프나 비밀값을 에이전트, 로그, 프롬프트, 터미널 출력에 붙여넣지 않습니다.',
  '줄 번호 정렬, 구분선, 제어 코드, 이스케이프 시퀀스, 빈 줄을 보존합니다.',
]

export const MCP_STATUS_CARDS: McpStatusCard[] = [
  {
    status: 'enabled',
    label: MCP_STATUS_LABELS.enabled,
    description: '읽기 전용 도구와 프로젝트/제공자 안내를 사용할 수 있습니다.',
  },
  {
    status: 'degraded',
    label: MCP_STATUS_LABELS.degraded,
    description: '안내와 명령 미리보기는 가능하지만 프로젝트, 제공자, 실행 파일 중 일부가 준비되지 않았습니다.',
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

export function createAgentWorkspaceViewModel(cwdLabel?: string): AgentWorkspaceViewModel {
  return {
    route: AGENT_WORKSPACE_ROUTE,
    title: 'AI 작업공간',
    subtitle: '터미널, 에이전트 프리셋, 활동 기록, 승인 상태를 한곳에서 다루는 작업 공간입니다.',
    presets: AGENT_COMMAND_PRESETS,
    agentPresets: AGENT_CLI_PRESETS,
    mcpStatusCards: MCP_STATUS_CARDS,
    safetyGuidance: AGENT_SAFETY_GUIDANCE,
    drawer: createAgentTerminalDrawerState(cwdLabel),
    timeline: [
      { id: 'project-selected', title: '프로젝트 선택', status: 'waiting' },
      { id: 'extract-preview', title: '추출 미리보기', status: 'mocked' },
      { id: 'quality-review', title: '품질 점검', status: 'mocked' },
      { id: 'approval-gate', title: '승인 대기', status: 'ready' },
      { id: 'safe-apply', title: '안전 적용', status: 'waiting' },
    ],
  }
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
