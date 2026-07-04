import { describe, expect, it } from 'vitest'
import {
  AGENT_WORKSPACE_ROUTE,
  applyTerminalEvent,
  chooseActiveTerminalSessionId,
  createAgentWorkspaceViewModel,
  createCommandPreview,
  mcpStatusLabel,
  mergeTerminalSession,
  noProjectGuidance,
  providerNotReadyGuidance,
  sessionStateLabel,
  shouldPersistTerminalOutput,
} from '../../src/renderer/agentWorkspaceModel'
import type { TerminalSessionSummary } from '../../src/types/agentWorkspace'
import { createMockTerminalEvent } from '../utils/terminalFixtures'

describe('agent workspace UI model', () => {
  it('selects only real main-process sessions and keeps exited history available', () => {
    const exited = makeSession('term-exited', 'exited')
    const running = makeSession('term-running', 'running')

    expect(chooseActiveTerminalSessionId([], '')).toBe('')
    expect(chooseActiveTerminalSessionId([exited, running], '')).toBe('term-running')
    expect(chooseActiveTerminalSessionId([exited, running], 'term-exited')).toBe('term-exited')
    expect(chooseActiveTerminalSessionId([exited], 'missing')).toBe('term-exited')

    const merged = mergeTerminalSession([exited], running)
    expect(merged.map((session) => session.sessionId)).toEqual(['term-exited', 'term-running'])
  })

  it('exposes a first-class Agent Workspace route and honest preset scaffold', () => {
    const workspace = createAgentWorkspaceViewModel()

    expect(workspace.route).toBe(AGENT_WORKSPACE_ROUTE)
    expect(workspace.title).toContain('AI 작업공간')
    expect(workspace.presets.map((preset) => preset.id)).toContain('quality-review')
    expect(workspace.presets.map((preset) => preset.id)).not.toContain('safe-apply-plan')
    expect(workspace.agentPresets.map((preset) => preset.id)).toEqual(['codex', 'claude', 'generic'])
    expect(workspace.agentPresets[0].commandPreview).toContain('codex')
    expect(workspace.agentPresets[0].command.args).not.toContain('--cwd')
    expect(workspace.agentPresets[0].command.args).toEqual(['-c', 'features={}'])
    expect(workspace.agentPresets[0].executable.detectionStatus).toBe('unknown')
  })

  it('keeps command previews and starter prompts project-protecting', () => {
    const workspace = createAgentWorkspaceViewModel()
    const allPrompts = workspace.agentPresets.flatMap((preset) => preset.starterPrompts.map((prompt) => prompt.prompt))

    expect(createCommandPreview('codex', ['--cwd', 'C:\\Game Project'])).toBe('codex --cwd "C:\\Game Project"')
    expect(allPrompts.join('\n')).toContain('게임 파일을 수정하지')
    expect(allPrompts.join('\n')).toContain('.llm-tsukuru-agent')
    expect(allPrompts.join('\n')).toContain('줄 번호')
    expect(workspace.safetyGuidance.join('\n')).toContain('비밀값')
  })

  it('exposes MCP enabled/degraded/disconnected UX states and setup guidance', () => {
    const workspace = createAgentWorkspaceViewModel()

    expect(workspace.mcpStatusCards.map((state) => state.status)).toEqual(['enabled', 'degraded', 'disconnected'])
    expect(mcpStatusLabel('degraded')).toBe('MCP 준비 필요')
    expect(providerNotReadyGuidance()).toContain('번역 제공자')
    expect(providerNotReadyGuidance()).toContain('설정 화면')
    expect(noProjectGuidance()).toContain('선택된 프로젝트가 없습니다')
  })

  it('renders supported session states through stable labels', () => {
    expect(sessionStateLabel('created')).toBe('생성됨')
    expect(sessionStateLabel('running')).toBe('실행 중')
    expect(sessionStateLabel('failed')).toBe('실패')
  })

  it('applies terminal events to real summaries without enabling persistence', () => {
    const session = makeSession('term-event', 'running')
    const event = createMockTerminalEvent(session.sessionId, 4, 'stdout', 'redacted terminal output')
    const updated = applyTerminalEvent(session, event)

    expect(session.persistOutput).toBe(false)
    expect(shouldPersistTerminalOutput(session)).toBe(false)
    expect(updated.latestSequence).toBe(4)
    expect(updated.sessionId).toBe('term-event')
    expect(shouldPersistTerminalOutput(updated)).toBe(false)
  })
})

function makeSession(sessionId: string, state: TerminalSessionSummary['state']): TerminalSessionSummary {
  return {
    schemaVersion: 1,
    sessionId,
    label: sessionId,
    kind: 'shell',
    state,
    cwdLabel: 'C:\\Games\\Fixture',
    outputRetention: 'ephemeral',
    persistOutput: false,
    latestSequence: 0,
    bridgeAttached: false,
    redactionCount: 0,
    truncationCount: 0,
  }
}
