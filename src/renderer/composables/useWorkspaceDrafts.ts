import { reactive } from 'vue'

export const workspaceDrafts = reactive({
  settingsDirty: false,
  translationDirty: false,
  translationBusy: false,
})

/** Refresh persisted values while retaining fields edited since the last refresh. */
export function mergeWorkspaceDraft<T extends Record<string, unknown>>(current: T, baseline: T, incoming: T): T {
  return Object.fromEntries(Object.keys(incoming).map(key => [key,
    JSON.stringify(current[key]) === JSON.stringify(baseline[key]) ? incoming[key] : current[key],
  ])) as T
}
