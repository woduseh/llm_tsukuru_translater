// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import LlmSettingsPage from '../../src/renderer/views/LlmSettingsPage.vue'

const { listeners, send } = vi.hoisted(() => {
  const listeners = new Map<string, (arg: unknown) => void>()
  const send = vi.fn()
  window.api = {
    on: (channel: string, callback: (arg: unknown) => void) => {
      listeners.set(channel, callback)
      return () => listeners.delete(channel)
    },
    send,
    invoke: vi.fn(),
  } as unknown as Window['api']
  return { listeners, send }
})

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn().mockResolvedValue({}) } }))

describe('translation request settings page', () => {
  let app: App
  let host: HTMLDivElement

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(LlmSettingsPage)
    app.mount(host)
    await loadSettings()
  })

  afterEach(() => {
    app.unmount()
    host.remove()
    listeners.clear()
    vi.clearAllMocks()
  })

  async function loadSettings(overrides: Record<string, unknown> = {}) {
    listeners.get('llmSettings')!({
      llmReady: true,
      llmProvider: 'gemini',
      ...overrides,
    })
    await nextTick()
  }

  function startButton() {
    return host.querySelector<HTMLButtonElement>('.button-bar .primary')!
  }

  async function setRpm(value: string) {
    const input = host.querySelector<HTMLInputElement>('#requestsPerMinute')!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    return input
  }

  async function setConcurrency(value: string) {
    const select = host.querySelector<HTMLSelectElement>('#parallelWorkers')!
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
  }

  it('keeps existing concurrency choices and adds eight while defaulting legacy settings to one and zero RPM', () => {
    const select = host.querySelector<HTMLSelectElement>('#parallelWorkers')!
    expect([...select.options].map((option) => option.value)).toEqual(['1', '2', '3', '4', '8'])
    expect(select.value).toBe('1')
    expect(host.querySelector<HTMLInputElement>('#requestsPerMinute')!.value).toBe('0')
    expect(startButton().disabled).toBe(false)
    expect(host.querySelector('label[for="parallelWorkers"]')!.textContent).toContain('동시 API 요청 수')
  })

  it('sends the selected numeric request limits once without changing the model', async () => {
    await loadSettings({ llmModel: 'user-selected-model', llmParallelWorkers: 2, llmRequestsPerMinute: 30 })
    await setConcurrency('8')
    await setRpm('120')

    startButton().click()
    await nextTick()
    startButton().click()

    const starts = send.mock.calls.filter(([channel]) => channel === 'llmSettingsApply')
    expect(starts).toHaveLength(1)
    expect(starts[0][1]).toMatchObject({ llmParallelWorkers: 8, llmRequestsPerMinute: 120 })
    expect(starts[0][1]).not.toHaveProperty('llmModel')
    expect(startButton().disabled).toBe(true)
  })

  it.each(['', '-1', '1.5', '60001'])('blocks starting with invalid RPM %s and explains how to fix it', async (value) => {
    const input = await setRpm(value)

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(startButton().disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('0~60000')
    expect(startButton().title).toContain('RPM')
    startButton().click()
    expect(send.mock.calls.some(([channel]) => channel === 'llmSettingsApply')).toBe(false)

    await setRpm('0')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(startButton().disabled).toBe(false)
  })

  it('blocks invalid incoming concurrency until the user selects an allowed value', async () => {
    await loadSettings({ llmParallelWorkers: 9 })
    expect(host.querySelector('#parallelWorkers')!.getAttribute('aria-invalid')).toBe('true')
    expect(startButton().disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('1~8')

    await setConcurrency('3')
    expect(startButton().disabled).toBe(false)
    startButton().click()
    expect(send).toHaveBeenCalledWith('llmSettingsApply', expect.objectContaining({ llmParallelWorkers: 3, llmRequestsPerMinute: 0 }))
  })

  it('preserves valid stored concurrency between four and eight instead of hiding or resetting it', async () => {
    await loadSettings({ llmParallelWorkers: 6, llmRequestsPerMinute: 60 })
    expect(host.querySelector<HTMLSelectElement>('#parallelWorkers')!.value).toBe('6')
    expect(startButton().disabled).toBe(false)

    startButton().click()

    expect(send).toHaveBeenCalledWith('llmSettingsApply', expect.objectContaining({ llmParallelWorkers: 6, llmRequestsPerMinute: 60 }))
  })
});
