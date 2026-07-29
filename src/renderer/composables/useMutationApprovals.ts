import { computed, readonly, ref } from 'vue'
import type {
  MutationApprovalOperationResult,
  MutationApprovalQueueSnapshot,
  MutationApprovalRendererView,
} from '../../types/agentWorkspace'
import { api } from './useIpc'

const approvals = ref<MutationApprovalRendererView[]>([])
const pendingCount = ref(0)
const loading = ref(false)
const message = ref('')
const busyApprovalIds = ref(new Set<string>())
let started = false
let refreshing: Promise<void> | null = null

function applySnapshot(snapshot: MutationApprovalQueueSnapshot) {
  approvals.value = snapshot.approvals
  pendingCount.value = snapshot.pendingCount
}

async function refresh(): Promise<void> {
  if (refreshing) return refreshing
  loading.value = true
  refreshing = (async () => {
    try {
      const result = await api.approvals.list({ schemaVersion: 1 })
      if (result.ok && result.approvals) {
        applySnapshot({
          schemaVersion: 1,
          approvals: result.approvals,
          pendingCount: result.approvals.filter((approval) => approval.status === 'pending').length,
        })
        if (message.value === '먼저 프로젝트 폴더를 선택하세요.') message.value = ''
      } else if (result.errorCode === 'runtime-unavailable') {
        applySnapshot({ schemaVersion: 1, approvals: [], pendingCount: 0 })
      } else {
        message.value = result.message || '승인 목록을 불러오지 못했습니다.'
      }
    } catch {
      message.value = '승인 목록을 불러오지 못했습니다.'
    } finally {
      loading.value = false
      refreshing = null
    }
  })()
  return refreshing
}

function setBusy(approvalId: string, busy: boolean) {
  const next = new Set(busyApprovalIds.value)
  if (busy) next.add(approvalId)
  else next.delete(approvalId)
  busyApprovalIds.value = next
}

async function runOperation(
  approvalId: string,
  operation: () => Promise<MutationApprovalOperationResult>,
): Promise<MutationApprovalOperationResult> {
  setBusy(approvalId, true)
  message.value = ''
  try {
    const result = await operation()
    if (!result.ok) message.value = result.message || '승인 작업을 처리하지 못했습니다.'
    await refresh()
    return result
  } catch {
    const result: MutationApprovalOperationResult = {
      schemaVersion: 1,
      ok: false,
      errorCode: 'ipc-failed',
      message: '승인 작업을 처리하지 못했습니다.',
    }
    message.value = result.message || ''
    await refresh()
    return result
  } finally {
    setBusy(approvalId, false)
  }
}

function approve(approvalId: string) {
  return runOperation(
    approvalId,
    () => api.approvals.approve({ schemaVersion: 1, approvalId }),
  )
}

function deny(approvalId: string, note?: string) {
  return runOperation(
    approvalId,
    () => api.approvals.deny({
      schemaVersion: 1,
      approvalId,
      ...(note?.trim() ? { note: note.trim() } : {}),
    }),
  )
}

function start() {
  if (started) return
  started = true
  api.approvals.onChanged(applySnapshot)
  window.setInterval(() => void refresh(), 30_000)
  void refresh()
}

export function useMutationApprovals() {
  start()
  return {
    approvals: readonly(approvals),
    pendingApprovals: computed(() => approvals.value.filter((approval) => approval.status === 'pending')),
    pendingCount: readonly(pendingCount),
    loading: readonly(loading),
    message: readonly(message),
    busyApprovalIds: readonly(busyApprovalIds),
    refresh,
    approve,
    deny,
  }
}
