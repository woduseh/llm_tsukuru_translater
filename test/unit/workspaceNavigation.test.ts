// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { send, fire } = vi.hoisted(() => {
  const send = vi.fn()
  window.api = { send } as unknown as Window['api']
  return { send, fire: vi.fn() }
})
vi.mock('sweetalert2', () => ({ default: { fire } }))
import { activeProject, projectBusy } from '../../src/renderer/composables/useProjectSession'
import { resetReviewWorkspace, reviewWorkspace } from '../../src/renderer/composables/useReviewWorkspace'
import { workspaceDrafts } from '../../src/renderer/composables/useWorkspaceDrafts'
import { chooseWorkspaceProject, workspaceActivity } from '../../src/renderer/composables/useWorkspaceNavigation'

describe('project replacement guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(activeProject, { path: '/game/data', engine: 'mvmz', mode: 0 })
    projectBusy.value = false
    workspaceActivity.translating = false
    resetReviewWorkspace('/game/data')
    Object.assign(workspaceDrafts, { settingsDirty: false, translationDirty: false, translationBusy: false })
  })
  it('does not open the picker while a review write is pending', async () => {
    reviewWorkspace.structure.busy = true
    await chooseWorkspaceProject('mvmz')
    expect(send).not.toHaveBeenCalled()
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ title: '현재 작업이 진행 중이에요' }))
  })
  it('preserves unsaved work when replacement is cancelled', async () => {
    reviewWorkspace.text.dirty = true
    fire.mockResolvedValue({ isConfirmed: false })
    await chooseWorkspaceProject('wolf')
    expect(send).not.toHaveBeenCalled()
    expect(activeProject.path).toBe('/game/data')
    expect(reviewWorkspace.text.dirty).toBe(true)
  })
  it('keeps drafts intact until a different folder is actually selected', async () => {
    workspaceDrafts.settingsDirty = true
    fire.mockResolvedValue({ isConfirmed: true })
    await chooseWorkspaceProject('wolf')
    expect(send).toHaveBeenCalledWith('select_folder', 'wolf_folder_input')
    expect(workspaceDrafts.settingsDirty).toBe(true)
    expect(activeProject.path).toBe('/game/data')
  })
})
