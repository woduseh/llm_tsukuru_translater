// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, h, KeepAlive, ref, type App } from 'vue'
import path from 'node:path'
import LlmComparePage from '../../src/renderer/views/LlmComparePage.vue'
import { resetReviewWorkspace, reviewWorkspace } from '../../src/renderer/composables/useReviewWorkspace'

const { listeners, send } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: string[]) => unknown>()
  const send = vi.fn()
  window.api = {
    on: (channel: string, callback: (...args: string[]) => unknown) => {
      listeners.set(channel, callback)
      return () => listeners.delete(channel)
    },
    removeAllListeners: (channel: string) => listeners.delete(channel),
    send,
  } as unknown as Window['api']
  return { listeners, send }
})

describe('compare page editing', () => {
  let app: App
  let host: HTMLDivElement
  let disk: Map<string, string>

  beforeEach(() => {
    resetReviewWorkspace()
    send.mockClear()
    disk = new Map()
    host = document.createElement('div')
    document.body.append(host)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    Element.prototype.scrollTo = vi.fn()
    window.nodePath = path.posix
    window.nodeFs = {
      existsSync: name => disk.has(name) || [...disk.keys()].some(key => key.startsWith(name + '/')),
      readdirSync: dir => [...disk.keys()].filter(key => key.startsWith(dir + '/')).map(key => path.posix.basename(key)),
      readFileSync: name => {
        const content = disk.get(name)
        if (content === undefined) throw new Error(`Missing fixture: ${name}`)
        return content
      },
      writeFileSync: (name, content) => { disk.set(name, content) },
    }
  })

  afterEach(() => {
    app?.unmount()
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    listeners.clear()
  })

  async function load(original: string, translated: string) {
    disk.set('/game/Extract_backup/Map001.txt', original)
    disk.set('/game/Extract/Map001.txt', translated)
    app = createApp(LlmComparePage)
    app.mount(host)
    await listeners.get('initCompare')!('/game')
    await nextTick()
  }

  function button(label: string) {
    const match = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
    if (!match) throw new Error(`Button not found: ${label}`)
    return match
  }

  it('reveals selection actions through a focusable checkbox and clears the selection', async () => {
    await load('--- 1 ---\nhello', '--- 1 ---\n안녕')
    expect(host.querySelector('.selection-toolbar')).toBeNull()
    expect(host.querySelector<HTMLDetailsElement>('.batch-actions')!.open).toBe(false)
    const checkbox = host.querySelector<HTMLInputElement>('.select-indicator input')!
    expect(checkbox.tabIndex).toBe(0)
    expect(checkbox.getAttribute('aria-label')).toBe('1번 블록 선택')
    checkbox.focus()
    expect(document.activeElement).toBe(checkbox)
    checkbox.click()
    await nextTick()
    expect(host.querySelector('.selection-toolbar')!.textContent).toContain('1개 선택')
    button('선택 해제').click()
    await nextTick()
    expect(checkbox.checked).toBe(false)
    expect(host.querySelector('.selection-toolbar')).toBeNull()
  })

  it('explains line mismatches and grows the virtual row when editing adds a line', async () => {
    await load('--- 1 ---\nhello\nworld', '--- 1 ---\n안녕')
    expect(host.querySelector('#block-diagnosis-0')!.textContent).toBe('번역 1줄 · 1줄 부족')
    const editor = host.querySelector<HTMLTextAreaElement>('.block-editor')!
    expect(editor.getAttribute('aria-describedby')).toBe('block-diagnosis-0')
    const row = host.querySelector<HTMLElement>('.block-row')!
    const previousHeight = parseInt(row.style.height)
    editor.value = '안녕\n세계\n추가'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(host.querySelector('#block-diagnosis-0')!.textContent).toBe('번역 3줄 · 1줄 초과')
    expect(parseInt(row.style.height)).toBeGreaterThan(previousHeight)
  })

  it('updates untranslated badges immediately after fixing selected block lines', async () => {
    await load('--- 1 ---\nhello\n', '--- 1 ---\nhello')
    expect(host.querySelector('.badge-untranslated-block')).toBeNull()
    expect(button('변경 저장').disabled).toBe(true)
    host.querySelector<HTMLElement>('.select-indicator')!.click()
    await nextTick()
    button('선택 블록 자동 수정').click()
    await nextTick()
    expect(host.querySelector('.block.error-lines')).toBeNull()
    expect(host.querySelector('.badge-untranslated-block')).not.toBeNull()
    expect(button('변경 저장').disabled).toBe(false)
  })

  it('distinguishes control-code mismatches from line-count mismatches', async () => {
    await load('--- 1 ---\nhello \\V[1]', '--- 1 ---\n안녕')
    expect(host.querySelector('#block-diagnosis-0')!.textContent).toBe('번역 1줄 · 제어 코드 불일치')
  })

  it('navigates to translation-only blocks and keeps edited text aligned when deleting one', async () => {
    await load('--- 1 ---\nhello', '--- 1 ---\n안녕\n--- 2 ---\nextra')
    const nextBlock = button('블록 ▶')
    expect(nextBlock.disabled).toBe(false)
    nextBlock.click()
    await nextTick()
    expect(host.querySelector('.block.selected')?.getAttribute('data-block-idx')).toBe('1')
    button('선택 블록 삭제').click()
    await nextTick()
    expect(host.querySelectorAll('.block-editor')).toHaveLength(1)
    expect(host.querySelector<HTMLTextAreaElement>('.block-editor')!.value).toBe('안녕')
    expect(button('블록 ▶').disabled).toBe(true)
    expect(button('변경 저장').disabled).toBe(false)
  })

  it('keeps mismatch filters in sync after saving edits without losing separators or empty lines', async () => {
    await load('--- 1 ---\nhello\n', '--- 1 ---\n안녕')
    host.querySelector<HTMLInputElement>('.filter-row input')!.click()
    await nextTick()
    expect(host.querySelectorAll('.file-item')).toHaveLength(1)
    const editor = host.querySelector<HTMLTextAreaElement>('.block-editor')!
    editor.value = '안녕\n'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(host.querySelector('.block.error-lines')).toBeNull()
    button('변경 저장').click()
    await vi.waitFor(() => expect(button('변경 저장').disabled).toBe(true))
    expect(disk.get('/game/Extract/Map001.txt')).toBe('--- 1 ---\n안녕\n')
    expect(host.querySelectorAll('.file-item')).toHaveLength(0)
    expect(host.querySelector('.badge-dirty')).toBeNull()
  })

  it('preserves unsaved edits on tab switches and ignores save shortcuts while inactive', async () => {
    disk.set('/game/Extract_backup/Map001.txt', 'hello')
    disk.set('/game/Extract/Map001.txt', '안녕')
    const visible = ref(true)
    app = createApp({ render: () => h(KeepAlive, () => visible.value ? h(LlmComparePage, { embedded: true }) : h('div')) })
    app.mount(host)
    await listeners.get('initCompare')!('/game')
    await nextTick()
    const editor = host.querySelector<HTMLTextAreaElement>('.block-editor')!
    editor.value = '저장 전 편집'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(reviewWorkspace.text.dirty).toBe(true)
    visible.value = false
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await nextTick()
    expect(disk.get('/game/Extract/Map001.txt')).toBe('안녕')
    visible.value = true
    await nextTick()
    expect(host.querySelector<HTMLTextAreaElement>('.block-editor')!.value).toBe('저장 전 편집')
    expect(reviewWorkspace.text.dirty).toBe(true)
    expect(host.querySelector('.compare-layout.embedded')).not.toBeNull()
    expect(send.mock.calls.filter(call => call[0] === 'compareReady' && call[1]?.fresh)).toHaveLength(1)
  })

  it('resets dirty state, filters and editor contents for a newly initialized project', async () => {
    await load('hello', '안녕')
    const editor = host.querySelector<HTMLTextAreaElement>('.block-editor')!
    editor.value = '저장 전 편집'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector<HTMLInputElement>('.search-input')!.value = 'Map001'
    host.querySelector<HTMLInputElement>('.search-input')!.dispatchEvent(new Event('input'))
    await nextTick()
    disk.set('/other/Extract_backup/Map002.txt', 'world')
    disk.set('/other/Extract/Map002.txt', '세계')
    await listeners.get('initCompare')!('/other')
    await nextTick()
    expect(reviewWorkspace.projectDir).toBe('/other')
    expect(reviewWorkspace.text.dirty).toBe(false)
    expect(host.querySelector<HTMLInputElement>('.search-input')!.value).toBe('')
    expect(host.querySelector<HTMLTextAreaElement>('.block-editor')!.value).toBe('세계')
    expect(disk.get('/game/Extract/Map001.txt')).toBe('안녕')
  })

  it('explains when a structure file has no corresponding extracted text', async () => {
    resetReviewWorkspace('/game')
    reviewWorkspace.focusedFile = 'System.json'
    await load('hello', '안녕')
    expect(host.querySelector('.save-status')!.textContent).toContain('System.json에 대응하는 추출 텍스트 파일이 없어요')
  })

  it('refreshes externally translated files and summaries from disk', async () => {
    await load('hello', 'hello')
    expect(send).toHaveBeenCalledWith('compareReady', { fresh: true })
    expect(reviewWorkspace.text.untranslatedCount).toBe(1)
    disk.set('/game/Extract/Map001.txt', '새 번역')
    button('디스크에서 다시 읽기').click()
    await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('.block-editor')!.value).toBe('새 번역'))
    expect(reviewWorkspace.text.untranslatedCount).toBe(0)
  })

  it('keeps dirty edits if disk refresh is cancelled and discards only on confirmation', async () => {
    await load('hello', '안녕')
    const editor = host.querySelector<HTMLTextAreaElement>('.block-editor')!
    editor.value = '저장 전 편집'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    button('디스크에서 다시 읽기').click()
    await nextTick()
    expect(editor.value).toBe('저장 전 편집')
    expect(reviewWorkspace.text.dirty).toBe(true)
    confirm.mockReturnValue(true)
    button('디스크에서 다시 읽기').click()
    await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('.block-editor')!.value).toBe('안녕'))
    expect(reviewWorkspace.text.dirty).toBe(false)
  })
})
