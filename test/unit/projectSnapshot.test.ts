// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import ProjectSnapshot from '../../src/renderer/components/ProjectSnapshot.vue'

vi.hoisted(() => {
  window.api = { on: () => () => {} } as unknown as Window['api']
})

describe('project file status', () => {
  let app: App
  let host: HTMLDivElement
  afterEach(() => { app?.unmount(); host?.remove() })
  async function mount(exists: () => boolean, entries: string[] = []) {
    window.nodePath = { join: (...parts: string[]) => parts.join('/') } as Window['nodePath']
    window.nodeFs = { existsSync: exists, readdirSync: () => entries } as unknown as Window['nodeFs']
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(ProjectSnapshot, { folder: '/game/data', engine: 'mvmz' })
    app.mount(host)
    await nextTick()
    return host.querySelector('[role="status"]')!
  }
  it('counts extracted text without treating metadata as translated or verified output', async () => {
    const status = await mount(() => true, ['Map001.txt', 'Map002.TXT', 'Map001.extracteddata'])
    expect(status.textContent).toContain('2개 파일')
    expect(host.textContent).toContain('적용 가능 여부는 검수에서 확인')
  })
  it('distinguishes absent extraction from an unreadable project', async () => {
    const status = await mount(() => false)
    expect(status.textContent).toContain('추출 폴더 없음')
    window.nodeFs.existsSync = () => { throw new Error('Access denied') }
    host.querySelector('button')!.click()
    await nextTick()
    expect(status.textContent).toContain('읽지 못했어요')
  })
})
