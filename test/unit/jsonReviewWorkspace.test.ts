// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, KeepAlive, nextTick, ref, type App } from 'vue'
import path from 'node:path'
import JsonVerifyPage from '../../src/renderer/views/JsonVerifyPage.vue'
import { resetReviewWorkspace, reviewWorkspace } from '../../src/renderer/composables/useReviewWorkspace'

const { listeners, send } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const send = vi.fn()
  window.api = {
    on: (channel: string, callback: (...args: unknown[]) => unknown) => {
      listeners.set(channel, callback)
      return () => listeners.delete(channel)
    },
    send,
  } as unknown as Window['api']
  return { listeners, send }
})

describe('structure review workspace', () => {
  let app: App
  let host: HTMLDivElement

  beforeEach(() => {
    resetReviewWorkspace('/game')
    host = document.createElement('div')
    document.body.append(host)
    window.nodePath = path.posix
    window.nodeFs = {
      existsSync: () => true,
      readdirSync: () => ['Map001.json', 'Map002.json'],
      readFileSync: () => '{"name":"sample"}',
      writeFileSync: vi.fn(),
    }
    window.verify = {
      verifyJsonIntegrity: () => [{ path: '$.name', type: 'type_mismatch', severity: 'error', message: 'test issue' }],
      repairJson: vi.fn(), getAtPath: vi.fn(), setAtPath: vi.fn(),
    }
  })

  afterEach(() => {
    app?.unmount()
    host.remove()
    listeners.clear()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('opens the selected file in text review using the actual project directory', async () => {
    reviewWorkspace.focusedFile = 'Map002.txt'
    app = createApp(JsonVerifyPage, { embedded: true })
    app.mount(host)
    listeners.get('initVerify')!('/game')
    await nextTick()
    expect(host.querySelector('.issues-file-name')!.textContent).toBe('Map002.json')
    expect(reviewWorkspace.structure).toEqual({ fileCount: 2, issueCount: 2, busy: false, loaded: true })
    const button = [...host.querySelectorAll('button')].find(node => node.textContent === '같은 파일의 번역 보기')!
    button.click()
    expect(send).toHaveBeenCalledWith('openLLMCompare', '/game')
    expect(reviewWorkspace.focusedFile).toBe('Map002.json')
    expect([...host.querySelectorAll('button')].some(node => node.textContent === '닫기')).toBe(false)
  })

  it('follows newly focused text files on activation without reloading diagnostics', async () => {
    const visible = ref(true)
    app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(JsonVerifyPage, { embedded: true }) : h('div')) })
    app.mount(host)
    listeners.get('initVerify')!('/game')
    await nextTick()
    expect(host.querySelector('.issues-file-name')!.textContent).toBe('Map001.json')
    visible.value = false
    await nextTick()
    reviewWorkspace.focusedFile = 'Map002.txt'
    visible.value = true
    await nextTick()
    expect(host.querySelector('.issues-file-name')!.textContent).toBe('Map002.json')
    expect(send).toHaveBeenCalledWith('verifyReady')
    expect(send.mock.calls.filter(call => call[0] === 'verifyReady' && call[1]?.fresh)).toHaveLength(1)
    expect(reviewWorkspace.structure.issueCount).toBe(2)
  })

  it('rechecks changed disk output and updates issue summaries', async () => {
    app = createApp(JsonVerifyPage, { embedded: true })
    app.mount(host)
    expect(send).toHaveBeenCalledWith('verifyReady', { fresh: true })
    listeners.get('initVerify')!('/game')
    await nextTick()
    expect(reviewWorkspace.structure.issueCount).toBe(2)
    window.verify.verifyJsonIntegrity = () => []
    const button = [...host.querySelectorAll('button')].find(node => node.textContent === '다시 검사')!
    button.click()
    await nextTick()
    expect(reviewWorkspace.structure.issueCount).toBe(0)
    expect(host.querySelector('.no-issues-header')!.textContent).toContain('구조적 문제가 없습니다')
  })

  it('requires confirmation before a recheck discards unapplied LLM repair previews', async () => {
    window.verify.verifyJsonIntegrity = () => [{ path: '$.name', type: 'text_shift', severity: 'error', message: 'shift', origValue: 'original' }]
    app = createApp(JsonVerifyPage, { embedded: true })
    app.mount(host)
    listeners.get('initVerify')!('/game')
    listeners.get('verifySettings')!({ llmReady: true })
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-harness-shift-repair]')!.click()
    await nextTick()
    const refresh = [...host.querySelectorAll('button')].find(node => node.textContent === '다시 검사')!
    expect(refresh.disabled).toBe(true)
    const request = send.mock.calls.find(call => call[0] === 'verifyLlmRepair')![1]
    listeners.get('verifyLlmRepairDone')!({ requestId: request.requestId, success: true, results: [{ path: '$.name', origText: 'original', newText: '수정' }] })
    await nextTick()
    expect(host.querySelector('.llm-preview')).not.toBeNull()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    refresh.click()
    await nextTick()
    expect(host.querySelector('.llm-preview')).not.toBeNull()
    confirm.mockReturnValue(true)
    refresh.click()
    await nextTick()
    expect(host.querySelector('.llm-preview')).toBeNull()
  })

  async function startRepair() {
    listeners.get('initVerify')!('/game')
    listeners.get('verifySettings')!({ llmReady: true })
    await nextTick()
    host.querySelector<HTMLInputElement>('.issue-checkbox input')!.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-harness-shift-repair]')!.click()
    await nextTick()
    return send.mock.calls.find(call => call[0] === 'verifyLlmRepair')![1]
  }

  async function finishRepair(request: { requestId: string }) {
    listeners.get('verifyLlmRepairDone')!({ requestId: request.requestId, success: true, results: [{ path: '$.name', origText: 'original', newText: '수정' }] })
    await nextTick()
  }

  it('locks structure writes while an LLM repair is running and unlocks after completion', async () => {
    window.verify.verifyJsonIntegrity = () => [{ path: '$.name', type: 'text_shift', severity: 'error', message: 'shift', origValue: 'original' }]
    app = createApp(JsonVerifyPage, { embedded: true })
    app.mount(host)
    const request = await startRepair()
    const buttons = ['선택 되돌리기', '현재 파일 수정', '전체 수정'].map(label =>
      [...host.querySelectorAll('button')].find(button => button.textContent === label)!)
    for (const button of buttons) {
      expect(button.disabled).toBe(true)
      button.click()
    }
    expect(send.mock.calls.some(call => call[0] === 'verifyApplyJson')).toBe(false)
    expect(window.verify.repairJson).not.toHaveBeenCalled()
    await finishRepair(request)
    for (const button of buttons) expect(button.disabled).toBe(false)
  })

  it('preserves previews on same-file selection and requires confirmation to select another file', async () => {
    window.verify.verifyJsonIntegrity = () => [{ path: '$.name', type: 'text_shift', severity: 'error', message: 'shift', origValue: 'original' }]
    app = createApp(JsonVerifyPage, { embedded: true })
    app.mount(host)
    await finishRepair(await startRepair())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fileButtons = host.querySelectorAll<HTMLButtonElement>('.file-item')
    fileButtons[0].click()
    await nextTick()
    expect(confirm).not.toHaveBeenCalled()
    expect(host.querySelector('.llm-preview')).not.toBeNull()
    fileButtons[1].click()
    await nextTick()
    expect(confirm).toHaveBeenCalledOnce()
    expect(host.querySelector('.issues-file-name')!.textContent).toBe('Map001.json')
    expect(host.querySelector('.llm-preview')).not.toBeNull()
    confirm.mockReturnValue(true)
    fileButtons[1].click()
    await nextTick()
    expect(host.querySelector('.issues-file-name')!.textContent).toBe('Map002.json')
    expect(reviewWorkspace.focusedFile).toBe('Map002.json')
    expect(host.querySelector('.llm-preview')).toBeNull()
  })

  it('keeps unapplied previews when another tab changes the focused file without prompting', async () => {
    window.verify.verifyJsonIntegrity = () => [{ path: '$.name', type: 'text_shift', severity: 'error', message: 'shift', origValue: 'original' }]
    const visible = ref(true)
    app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(JsonVerifyPage, { embedded: true }) : h('div')) })
    app.mount(host)
    await finishRepair(await startRepair())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    visible.value = false
    await nextTick()
    reviewWorkspace.focusedFile = 'Map002.txt'
    visible.value = true
    await nextTick()
    expect(confirm).not.toHaveBeenCalled()
    expect(host.querySelector('.issues-file-name')!.textContent).toBe('Map001.json')
    expect(reviewWorkspace.focusedFile).toBe('Map001.json')
    expect(host.querySelector('.llm-preview')).not.toBeNull()
    expect(host.querySelector('[role="status"]')!.textContent).toContain('미리보기를 유지했어요')
  })
})
