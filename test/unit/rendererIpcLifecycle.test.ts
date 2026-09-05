// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import * as ipcChannels from '../../src/types/ipc'
import * as agentBridgeContracts from '../../src/agent/agentBridgeContracts'

vi.mock('../../src/renderer/components/AgentTerminalDrawer.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/renderer/components/AgentTerminalPane.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/renderer/components/AgentApprovalQueue.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/renderer/composables/useMutationApprovals', () => ({
  useMutationApprovals: () => ({ pendingApprovals: ref([]), pendingCount: ref(0), refresh: vi.fn() }),
}))
vi.mock('../../src/renderer/composables/useTerminalSessions', () => ({
  useTerminalSessions: () => ({ sessions: ref([]), launch: vi.fn() }),
}))

const ipcRenderer = Object.assign(new EventEmitter(), {
  send: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
})
let app: App | undefined
let host: HTMLDivElement | undefined
let useIpcOn: typeof import('../../src/renderer/composables/useIpc').useIpcOn

beforeAll(async () => {
  // Run the actual preload with an Electron event boundary, keeping its
  // whitelist and callback/event stripping behavior in this regression.
  const exposed: Record<string, unknown> = {}
  const source = readFileSync(path.join(process.cwd(), 'src/preload.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  runInNewContext(compiled, {
    exports: {},
    Buffer,
    require: (name: string) => {
      if (name === 'electron') return {
        contextBridge: { exposeInMainWorld: (key: string, value: unknown) => { exposed[key] = value } },
        ipcRenderer,
      }
      if (name === 'path') return path
      if (name === './types/ipc') return ipcChannels
      if (name === './agent/agentBridgeContracts') return agentBridgeContracts
      throw new Error(`Unexpected preload import: ${name}`)
    },
  })
  window.api = exposed.api as Window['api']
  useIpcOn = (await import('../../src/renderer/composables/useIpc')).useIpcOn
})

afterEach(() => {
  app?.unmount()
  app = undefined
  host?.remove()
  host = undefined
  ipcRenderer.removeAllListeners()
  document.documentElement.style.removeProperty('--mainColor')
  vi.clearAllMocks()
})

function mount(component: Parameters<typeof createApp>[0]) {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(component)
  app.mount(host)
}

describe('renderer IPC ownership', () => {
  it('unsubscribes only the owning component and resubscribes after remount', async () => {
    const showFirst = ref(true)
    const first = vi.fn()
    const second = vi.fn()
    const subscriber = (callback: () => void) => defineComponent({
      setup() {
        useIpcOn('worked', callback)
        return () => null
      },
    })
    const First = subscriber(first)
    const Second = subscriber(second)
    mount(defineComponent({
      setup: () => () => h('div', [showFirst.value ? h(First) : null, h(Second)]),
    }))
    expect(ipcRenderer.listenerCount('worked')).toBe(2)
    ipcRenderer.emit('worked', { sender: 'must not reach renderer callbacks' }, 'first event')
    expect(first).toHaveBeenLastCalledWith('first event')
    expect(second).toHaveBeenLastCalledWith('first event')

    showFirst.value = false
    await nextTick()
    expect(ipcRenderer.listenerCount('worked')).toBe(1)
    ipcRenderer.emit('worked', {}, 'second event')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenLastCalledWith('second event')

    showFirst.value = true
    await nextTick()
    expect(ipcRenderer.listenerCount('worked')).toBe(2)
    ipcRenderer.emit('worked', {}, 'third event')
    expect(first).toHaveBeenLastCalledWith('third event')
    expect(second).toHaveBeenCalledTimes(3)

    app!.unmount()
    app = undefined
    expect(ipcRenderer.listenerCount('worked')).toBe(0)
  })

  it('keeps unapproved channels outside the renderer subscription API', () => {
    const callback = vi.fn()
    window.api.on('not-an-approved-channel', callback)
    ipcRenderer.emit('not-an-approved-channel', {}, 'payload')
    expect(callback).not.toHaveBeenCalled()
    expect(ipcRenderer.listenerCount('not-an-approved-channel')).toBe(0)
  })

  it('keeps app theme subscriptions across project and settings routes, including Agent Workspace', async () => {
    const Root = (await import('../../src/renderer/App.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: () => import('../../src/renderer/views/HomePage.vue') },
        { path: '/mvmz', component: () => import('../../src/renderer/views/MvMzPage.vue') },
        { path: '/wolf', component: () => import('../../src/renderer/views/WolfPage.vue') },
        { path: '/agent-workspace', component: () => import('../../src/renderer/views/AgentWorkspacePage.vue') },
        { path: '/settings', component: () => import('../../src/renderer/views/SettingsPage.vue') },
        { path: '/llm-settings', component: () => import('../../src/renderer/views/LlmSettingsPage.vue') },
        { path: '/json-verify', component: () => import('../../src/renderer/views/JsonVerifyPage.vue') },
      ],
    })
    await router.push('/')
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(Root)
    app.use(router)
    app.mount(host)

    const visits = [
      ['/', 'getGlobalSettings'],
      ['/mvmz', 'getGlobalSettings'],
      ['/wolf', 'getGlobalSettings'],
      ['/agent-workspace', 'getGlobalSettings'],
      ['/settings', 'settings'],
      ['/llm-settings', 'llmSettings'],
      ['/json-verify', 'verifySettings'],
      ['/', 'getGlobalSettings'],
    ]
    const cachedConsumers = new Set<string>()
    for (const [index, [route, channel]] of visits.entries()) {
      await router.push(route)
      await nextTick()
      if (channel !== 'getGlobalSettings') cachedConsumers.add(channel)
      expect(ipcRenderer.listenerCount('getGlobalSettings'), route).toBe(1)
      for (const settingsChannel of ['settings', 'llmSettings', 'verifySettings']) {
        // Cached workspace tabs retain exactly one data consumer plus the app theme consumer.
        expect(ipcRenderer.listenerCount(settingsChannel), `${route}: ${settingsChannel}`)
          .toBe(cachedConsumers.has(settingsChannel) ? 2 : 1)
      }
      const color = `rgb(${index}, 20, 30)`
      ipcRenderer.emit(channel, {}, {
        themeData: { '--mainColor': color },
        llmReady: true,
        llmProvider: 'vertex',
        llmModel: 'fixture-model',
        llmParallelWorkers: 3,
      })
      await nextTick()
      expect(document.documentElement.style.getPropertyValue('--mainColor'), route).toBe(color)
      if (channel === 'settings') {
        expect(host.querySelector<HTMLSelectElement>('#llmProvider')!.value).toBe('vertex')
        expect(host.querySelector<HTMLInputElement>('#llmModel')!.value).toBe('fixture-model')
      } else if (channel === 'llmSettings') {
        expect(host.querySelector('[data-harness-view="llm-settings"]')?.getAttribute('data-llm-ready')).toBe('true')
        expect(host.querySelector<HTMLSelectElement>('#parallelWorkers')!.value).toBe('3')
      } else if (channel === 'verifySettings') {
        expect(host.querySelector('[data-harness-shift-repair]')?.textContent).toContain('줄밀림 LLM 수정')
      }
    }
    for (const channel of ['getGlobalSettings', 'settings', 'llmSettings', 'verifySettings']) {
      ipcRenderer.emit(channel, {}, { themeData: { '--mainColor': channel } })
      expect(document.documentElement.style.getPropertyValue('--mainColor')).toBe(channel)
    }
    app.unmount()
    app = undefined
    for (const channel of ['getGlobalSettings', 'settings', 'llmSettings', 'verifySettings']) {
      expect(ipcRenderer.listenerCount(channel)).toBe(0)
    }
  })
})
