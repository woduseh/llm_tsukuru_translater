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
    expect(workspace.agentPresets[0].executable.detectionStatus).toBe('unknown')
  })

  it('keeps agent command previews and starter prompts safe and non-destructive', () => {
    const workspace = createAgentWorkspaceViewModel()
    const allPrompts = workspace.agentPresets.flatMap((preset) => preset.starterPrompts.map((prompt) => prompt.prompt))

    expect(createCommandPreview('codex', ['--cwd', 'C:\\Game Project'])).toBe('codex --cwd "C:\\Game Project"')
    expect(allPrompts.join('\n')).toContain('Do not run destructive commands')
    expect(allPrompts.join('\n')).toContain('preserve line numbers')
    expect(workspace.safetyGuidance.join('\n')).toContain('Do not paste full source dumps or secrets')
  })

  it('exposes MCP enabled/degraded/disconnected UX states and setup guidance', () => {
    const workspace = createAgentWorkspaceViewModel()

    expect(workspace.mcpStatusCards.map((state) => state.status)).toEqual(['enabled', 'degraded', 'disconnected'])
    expect(mcpStatusLabel('degraded')).toBe('MCP degraded')
    expect(providerNotReadyGuidance()).toContain('Provider is not ready')
    expect(providerNotReadyGuidance()).toContain('credentials there only')
    expect(noProjectGuidance()).toContain('No project is selected')
  })

  it('renders supported session states through stable labels', () => {
    expect(sessionStateLabel('created')).toBe('Created')
    expect(sessionStateLabel('running')).toBe('Running')
    expect(sessionStateLabel('failed')).toBe('Failed')
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
