import type { TerminalSessionKind } from './types/agentWorkspace'

export type ManagedTerminalPresetId = 'codex' | 'claude'

export interface ManagedTerminalPreset {
  id: ManagedTerminalPresetId
  kind: Extract<TerminalSessionKind, 'codex' | 'claude'>
  title: string
  executableNames: string[]
  args: string[]
  description: string
  detectionMessage: string
  mcpMessage: string
}

export const MANAGED_TERMINAL_PRESETS: Record<ManagedTerminalPresetId, ManagedTerminalPreset> = {
  codex: {
    id: 'codex',
    kind: 'codex',
    title: 'Codex CLI',
    executableNames: ['codex.cmd', 'codex.exe', 'codex'],
    args: ['-c', 'features={}'],
    description: '현재 프로젝트 폴더에서 Codex를 실행합니다. 작업 폴더는 터미널 cwd로 지정하고, 깨진 features 설정을 피하기 위해 안전한 feature override를 적용합니다.',
    detectionMessage: 'Codex CLI 감지는 시작 시 메인 프로세스에서 수행됩니다. 실패하면 설치/버전 확인 안내를 표시합니다.',
    mcpMessage: 'MCP 연결은 준비 중입니다. 지금은 터미널 cwd와 안전 안내를 기준으로 사용하세요.',
  },
  claude: {
    id: 'claude',
    kind: 'claude',
    title: 'Claude CLI',
    executableNames: ['claude.cmd', 'claude.exe', 'claude'],
    args: [],
    description: '현재 프로젝트 폴더에서 Claude CLI를 실행합니다. 권한/승인 모드는 CLI 내부 설정을 따릅니다.',
    detectionMessage: 'Claude CLI 감지는 시작 시 메인 프로세스에서 수행됩니다. 실패하면 설치/버전 확인 안내를 표시합니다.',
    mcpMessage: 'MCP 연결은 준비 중입니다. 지금은 안전 프롬프트와 읽기 전용 컨텍스트 안내를 사용하세요.',
  },
}

export function managedTerminalPresetForKind(kind: TerminalSessionKind): ManagedTerminalPreset | undefined {
  if (kind === 'codex') return MANAGED_TERMINAL_PRESETS.codex
  if (kind === 'claude') return MANAGED_TERMINAL_PRESETS.claude
  return undefined
}

export function createTerminalCommandPreview(executable: string, args: string[]): string {
  return [quoteCommandPart(executable), ...args.map(quoteCommandPart)].join(' ')
}

function quoteCommandPart(part: string): string {
  return /[\s"]/g.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part
}
