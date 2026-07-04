/**
 * Pure derivation of the agent workspace's live readiness from real app signals.
 * Kept dependency-free so it can be unit-tested and type-imported by the renderer.
 */

export interface AgentWorkspaceStatusInput {
  /** Trusted project roots currently registered (terminal/agent scope). */
  projectRoots: string[];
  /** The active project root, if one has been focused. */
  currentProjectRoot?: string;
  /** Result of getLlmReadinessError(): null when the provider is ready. */
  providerReadyError: string | null;
  /** TerminalCapability.status, e.g. 'enabled' | 'degraded'. */
  terminalCapabilityStatus?: string;
  /** Optional human-readable reason when the terminal is not enabled. */
  terminalReason?: string;
  /** Whether the bundled MCP server file is present (built). Defaults to true when omitted. */
  mcpServerBundleAvailable?: boolean;
}

export interface AgentWorkspaceStatus {
  schemaVersion: 1;
  project: { selected: boolean; label: string };
  provider: { ready: boolean; message: string };
  terminal: { available: boolean; message: string };
  mcp: { serverAvailable: boolean; message: string };
}

function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

export function buildAgentWorkspaceStatus(input: AgentWorkspaceStatusInput): AgentWorkspaceStatus {
  const roots = Array.isArray(input.projectRoots) ? input.projectRoots.filter(Boolean) : [];
  const selected = roots.length > 0;
  const active = input.currentProjectRoot && input.currentProjectRoot.length > 0
    ? input.currentProjectRoot
    : roots[roots.length - 1];
  const label = selected && active ? baseName(active) : '프로젝트 미선택';

  const providerReady = input.providerReadyError === null;
  const providerMessage = providerReady
    ? '번역 제공자가 준비되었습니다.'
    : (input.providerReadyError || '번역 제공자가 준비되지 않았습니다.');

  const mcpAvailable = input.mcpServerBundleAvailable !== false;
  const terminalAvailable = input.terminalCapabilityStatus === 'enabled';
  const terminalMessage = terminalAvailable
    ? '내장 터미널을 사용할 수 있습니다.'
    : (input.terminalReason || '내장 터미널을 사용할 수 없습니다.');

  return {
    schemaVersion: 1,
    project: { selected, label },
    provider: { ready: providerReady, message: providerMessage },
    terminal: { available: terminalAvailable, message: terminalMessage },
    mcp: {
      serverAvailable: mcpAvailable,
      message: mcpAvailable
        ? '프로젝트 파일 보호 MCP 서버를 연결할 수 있습니다. 분석 산출물은 전용 작업공간에만 기록됩니다.'
        : 'MCP 서버 번들이 없습니다. 앱을 다시 빌드하세요 (npm run build:mcp).',
    },
  };
}
