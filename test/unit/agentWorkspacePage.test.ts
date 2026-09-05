// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref, type App } from 'vue'
import AgentWorkspacePage from '../../src/renderer/views/AgentWorkspacePage.vue'
import { AGENT_CLI_PRESETS, createAgentWorkspaceViewModel } from '../../src/renderer/agentWorkspaceModel'
import { buildAgentWorkspaceStatus } from '../../src/agent/agentWorkspaceStatus'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../src/renderer/composables/useIpc', () => ({ api: { invoke } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('../../src/renderer/components/TitleBar.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/renderer/components/AgentTerminalPane.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/renderer/components/AgentApprovalQueue.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/renderer/composables/useMutationApprovals', () => ({
  useMutationApprovals: () => ({ refresh: vi.fn() }),
}))
vi.mock('../../src/renderer/composables/useTerminalSessions', () => ({
  useTerminalSessions: () => ({ sessions: ref([]), launch: vi.fn() }),
}))

const originalPresets = structuredClone(AGENT_CLI_PRESETS)
let app: App | undefined
let host: HTMLDivElement
let serverAvailable: boolean
let detection: () => Promise<unknown>
const availableExecutables = { results: [{ id: 'codex', status: 'available' }, { id: 'claude', status: 'available' }] }

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  serverAvailable = true
  detection = async () => availableExecutables
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'detectAgentExecutables') return detection()
    if (channel === 'getAgentWorkspaceStatus') return buildAgentWorkspaceStatus({
      projectRoots: ['C:/Games/Fixture'],
      providerReadyError: null,
      terminalCapabilityStatus: 'enabled',
      mcpServerBundleAvailable: serverAvailable,
    })
    throw new Error(`Unexpected IPC channel: ${channel}`)
  })
})

afterEach(() => {
  app?.unmount()
  app = undefined
  host.remove()
  // A failing regression must not leave a shared preset mutated for later tests.
  AGENT_CLI_PRESETS.forEach((preset, index) => Object.assign(preset, structuredClone(originalPresets[index])))
  vi.clearAllMocks()
})

function mount() {
  app = createApp(AgentWorkspacePage)
  app.mount(host)
}

function codexMcpStatus() {
  return host.querySelector('[data-harness-agent-cli-presets] button')?.getAttribute('data-mcp-status')
}

describe('agent workspace live state', () => {
  it('does not retain another page instance\'s executable detection in preset definitions', async () => {
    mount()
    await vi.waitFor(() => expect(codexMcpStatus()).toBe('enabled'))
    expect(host.querySelector('.exe-status')?.getAttribute('data-exe-status')).toBe('available')
    expect(createAgentWorkspaceViewModel().agentPresets[0].executable.detectionStatus).toBe('unknown')

    app!.unmount()
    let finishDetection!: (value: unknown) => void
    detection = () => new Promise(resolve => { finishDetection = resolve })
    mount()
    await nextTick()
    expect(host.querySelector('.exe-status')?.getAttribute('data-exe-status')).toBe('unknown')
    finishDetection(availableExecutables)
    await vi.waitFor(() => expect(codexMcpStatus()).toBe('enabled'))
  })

  it('updates derived MCP readiness from status changes while a new executable probe is pending', async () => {
    mount()
    await vi.waitFor(() => expect(codexMcpStatus()).toBe('enabled'))
    let finishDetection!: (value: unknown) => void
    detection = () => new Promise(resolve => { finishDetection = resolve })
    serverAvailable = false
    window.dispatchEvent(new Event('focus'))

    try {
      await vi.waitFor(() => expect(host.querySelector('.env-status li:last-child')?.getAttribute('data-ok')).toBe('false'))
      expect(codexMcpStatus()).toBe('disconnected')
      expect([...host.querySelectorAll('.timeline li')].map(item => item.getAttribute('data-status')))
        .toEqual(['ready', 'waiting', 'waiting', 'waiting'])
    } finally {
      finishDetection(availableExecutables)
      await nextTick()
    }
  })

  it('does not subscribe to focus after unmounting during the initial executable probe', async () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    let finishDetection!: (value: unknown) => void
    detection = () => new Promise(resolve => { finishDetection = resolve })
    try {
      mount()
      app!.unmount()
      app = undefined
      const requestCount = invoke.mock.calls.length
      finishDetection(availableExecutables)
      await new Promise(resolve => setTimeout(resolve, 0))
      window.dispatchEvent(new Event('focus'))
      await nextTick()
      expect(invoke).toHaveBeenCalledTimes(requestCount)
    } finally {
      for (const [type, callback] of addListener.mock.calls) {
        if (type === 'focus') window.removeEventListener(type, callback)
      }
      addListener.mockRestore()
    }
  })
})
