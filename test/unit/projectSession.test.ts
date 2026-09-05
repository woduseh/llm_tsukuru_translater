import { beforeEach, describe, expect, it } from 'vitest'
import { activeProject, useProjectSession } from '../../src/renderer/composables/useProjectSession'

describe('project session navigation', () => {
  beforeEach(() => Object.assign(activeProject, { engine: '', path: '', mode: -1 }))

  it('restores the chosen project and tool when returning to a page', () => {
    const first = useProjectSession('mvmz')
    first.folderPath.value = '/game/data'
    first.mode.value = 1
    const returned = useProjectSession('mvmz')
    expect(returned.folderPath.value).toBe('/game/data')
    expect(returned.mode.value).toBe(1)
  })

  it('does not reuse a previous engine project after a different selection', () => {
    const mv = useProjectSession('mvmz')
    mv.folderPath.value = '/mv/data'
    mv.mode.value = 1
    const wolf = useProjectSession('wolf')
    expect(wolf.folderPath.value).toBe('')
    wolf.folderPath.value = '/wolf'
    expect(wolf.mode.value).toBe(0)
    expect(mv.folderPath.value).toBe('')
    expect(mv.mode.value).toBe(-1)
  })
})
