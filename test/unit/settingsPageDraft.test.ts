// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, KeepAlive, nextTick, ref, type App } from 'vue'
import SettingsPage from '../../src/renderer/views/SettingsPage.vue'
import { workspaceDrafts } from '../../src/renderer/composables/useWorkspaceDrafts'

const { listeners, send } = vi.hoisted(() => {
  const listeners = new Map<string, (arg: unknown) => void>()
  const send = vi.fn()
  window.api = {
    on: (channel: string, callback: (arg: unknown) => void) => {
      listeners.set(channel, callback)
      return () => listeners.delete(channel)
    }, send, invoke: vi.fn(),
  } as unknown as Window['api']
  return { listeners, send }
})

describe('settings workspace drafts', () => {
  let app: App
  let host: HTMLDivElement
  const visible = ref(true)
  beforeEach(async () => {
    visible.value = true
    host = document.createElement('div')
    document.body.append(host)
    const other = defineComponent(() => () => h('div', 'other tab'))
    app = createApp({ render: () => h(KeepAlive, null, { default: () => visible.value ? h(SettingsPage, { embedded: true }) : h(other) }) })
    app.mount(host)
    await refresh({ llmModel: 'saved-model', llmCustomPrompt: 'saved-prompt' })
  })
  afterEach(() => {
    app.unmount()
    host.remove()
    listeners.clear()
    vi.clearAllMocks()
  })
  async function refresh(overrides: Record<string, unknown>) {
    listeners.get('settings')!({ llmModel: 'saved-model', llmCustomPrompt: 'saved-prompt', ...overrides })
    await nextTick()
  }
  async function edit(selector: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(selector)!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  it('refreshes on reactivation and merges unchanged fields without discarding edits', async () => {
    await edit('#llmModel', 'draft-model')
    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()
    expect(send.mock.calls.filter(([channel]) => channel === 'settingsReady')).toHaveLength(2)
    await refresh({ llmCustomPrompt: 'new-generated-guideline' })
    expect(host.querySelector<HTMLInputElement>('#llmModel')!.value).toBe('draft-model')
    expect(host.querySelector<HTMLTextAreaElement>('#llmCustomPrompt')!.value).toBe('new-generated-guideline')
    expect(workspaceDrafts.settingsDirty).toBe(true)
  })
  it('clears the dirty marker only after save acknowledgement and releases failed save locks', async () => {
    await edit('#llmModel', 'draft-model')
    const apply = host.querySelector<HTMLButtonElement>('.btn-primary')!
    apply.click()
    await nextTick()
    expect(apply.disabled).toBe(true)
    expect(workspaceDrafts.settingsDirty).toBe(true)
    listeners.get('settingsSaveFailed')!(undefined)
    await nextTick()
    expect(apply.disabled).toBe(false)
    apply.click()
    listeners.get('settingsSaved')!({})
    await nextTick()
    expect(workspaceDrafts.settingsDirty).toBe(false)
  })
  it('restores the latest persisted values when cancelling edits', async () => {
    await edit('#llmModel', 'draft-model')
    await refresh({ llmModel: 'external-model' })
    host.querySelectorAll<HTMLButtonElement>('.button-bar button')[1].click()
    await nextTick()
    expect(host.querySelector<HTMLInputElement>('#llmModel')!.value).toBe('external-model')
    expect(workspaceDrafts.settingsDirty).toBe(false)
    expect(send).toHaveBeenCalledWith('closesettings')
  })
})
