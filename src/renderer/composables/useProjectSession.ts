import { computed, reactive, ref } from 'vue'

export type ProjectEngine = 'mvmz' | 'wolf'

// Session-only: a saved path must never substitute for the main process's folder grant.
export const activeProject = reactive({ engine: '' as ProjectEngine | '', path: '', mode: -1 })
export const projectBusy = ref(false)

export function useProjectSession(engine: ProjectEngine) {
  const folderPath = computed({
    get: () => activeProject.engine === engine ? activeProject.path : '',
    set: (path: string) => {
      if (activeProject.engine !== engine || activeProject.path !== path) {
        activeProject.engine = engine
        activeProject.path = path
        activeProject.mode = 0
      }
    },
  })
  const mode = computed({
    get: () => activeProject.engine === engine ? activeProject.mode : -1,
    set: (value: number) => { if (activeProject.engine === engine) activeProject.mode = value },
  })
  return { folderPath, mode, running: projectBusy }
}
