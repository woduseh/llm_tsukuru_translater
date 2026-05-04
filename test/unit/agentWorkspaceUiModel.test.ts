import { describe, expect, it } from 'vitest'
import {
  AGENT_WORKSPACE_ROUTE,
  applyTerminalEvent,
  createCommandPreview,
  createAgentTerminalDrawerState,
  createAgentWorkspaceViewModel,
  createMockTerminalEvent,
  mcpStatusLabel,
  noProjectGuidance,
  providerNotReadyGuidance,
  sessionStateLabel,
  setTerminalDrawerOpen,
  shouldPersistTerminalOutput,
} from '../../src/renderer/agentWorkspaceModel'

describe('agent workspace UI scaffold model', () => {
  it('starts with the compact terminal drawer collapsed and can open without creating processes', () => {
    const drawer = createAgentTerminalDrawerState('fixture-project')

    expect(drawer.isOpen).toBe(false)
    expect(drawer.sessions.map((session) => session.id)).toEqual(['codex', 'claude', 'shell'])

    const opened = setTerminalDrawerOpen(drawer, true)

    expect(opened.isOpen).toBe(true)
    expect(drawer.isOpen).toBe(false)
  })

  it('exposes a first-class Agent Workspace route and preset scaffold', () => {
    const workspace = createAgentWorkspaceViewModel()

    expect(workspace.route).toBe(AGENT_WORKSPACE_ROUTE)
    expect(workspace.title).toContain('AI 작업공간')
    expect(workspace.presets.map((preset) => preset.id)).toContain('quality-review')
    expect(workspace.presets.find((preset) => preset.id === 'safe-apply-plan')?.approvalRequired).toBe(true)
    expect(workspace.agentPresets.map((preset) => preset.id)).toEqual(['codex', 'claude', 'generic'])
    expect(workspace.agentPresets[0].commandPreview).toContain('codex')
    expect(workspace.agentPresets[0].command.args).not.toContain('--cwd')
    expect(workspace.agentPresets[0].command.args).toEqual(['-c', 'features={}'])
    expect(workspace.agentPresets[0].executable.detectionStatus).toBe('unknown')
  })

  it('keeps agent command previews and starter prompts safe and non-destructive', () => {
    const workspace = createAgentWorkspaceViewModel()
    const allPrompts = workspace.agentPresets.flatMap((preset) => preset.starterPrompts.map((prompt) => prompt.prompt))

    expect(createCommandPreview('codex', ['--cwd', 'C:\\Game Project'])).toBe('codex --cwd "C:\\Game Project"')
    expect(allPrompts.join('\n')).toContain('파괴적인 명령은 실행하지 마')
    expect(allPrompts.join('\n')).toContain('줄 번호')
    expect(workspace.safetyGuidance.join('\n')).toContain('비밀값')
  })

  it('exposes MCP enabled/degraded/disconnected UX states and setup guidance', () => {
    const workspace = createAgentWorkspaceViewModel()

    expect(workspace.mcpStatusCards.map((state) => state.status)).toEqual(['enabled', 'degraded', 'disconnected'])
    expect(mcpStatusLabel('degraded')).toBe('MCP 제한 모드')
    expect(providerNotReadyGuidance()).toContain('번역 제공자')
    expect(providerNotReadyGuidance()).toContain('설정 화면')
    expect(noProjectGuidance()).toContain('선택된 프로젝트가 없습니다')
  })

  it('renders supported session states through stable labels', () => {
    expect(sessionStateLabel('created')).toBe('생성됨')
    expect(sessionStateLabel('running')).toBe('실행 중')
    expect(sessionStateLabel('failed')).toBe('실패')
  })

  it('keeps terminal output non-persistent by default while tracking latest transient event', () => {
    const [session] = createAgentTerminalDrawerState().sessions
    const event = createMockTerminalEvent(session.id, 1, 'stdout', 'secret-like terminal output')
    const updated = applyTerminalEvent(session, event)

    expect(session.persistOutput).toBe(false)
    expect(shouldPersistTerminalOutput(session)).toBe(false)
    expect(updated.latestEvent?.data).toBe('secret-like terminal output')
    expect(shouldPersistTerminalOutput(updated)).toBe(false)
  })
})
