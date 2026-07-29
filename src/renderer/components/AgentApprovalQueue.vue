<template>
  <section class="approval-queue" data-harness-approval-queue aria-labelledby="approval-queue-title">
    <header class="queue-heading">
      <div>
        <p class="queue-eyebrow">사용자 확인 필요</p>
        <h2 id="approval-queue-title">변경 승인 큐</h2>
        <p>제안된 변경 내용을 검토한 뒤 각 요청을 직접 승인하거나 거절하세요.</p>
      </div>
      <div class="queue-summary" aria-live="polite">
        <strong data-harness-approval-pending-count>{{ pendingCount }}</strong>
        <span>승인 대기</span>
      </div>
    </header>

    <p v-if="message" class="queue-message" role="status">{{ message }}</p>
    <p v-if="loading && approvals.length === 0" class="queue-empty">승인 목록을 불러오는 중…</p>
    <p v-else-if="approvals.length === 0" class="queue-empty">현재 세션에 제출된 변경 요청이 없습니다.</p>

    <div v-else class="approval-list">
      <article
        v-for="approval in approvals"
        :id="`approval-${approval.approvalId}`"
        :key="approval.approvalId"
        class="approval-card"
        :class="`status-${approval.status}`"
        :data-approval-id="approval.approvalId"
        :data-approval-status="approval.status"
        data-harness-approval-request
        tabindex="-1"
      >
        <details :open="approval.status === 'pending' || approval.approvalId === focusApprovalId">
          <summary>
            <div class="request-title">
              <span class="status-badge">{{ statusLabel(approval.status) }}</span>
              <strong>{{ approval.preview.targetPath }}</strong>
              <span>{{ approval.preview.operations.length }}개 줄 변경</span>
            </div>
            <span class="request-source">{{ sourceLabel(approval.requestSource) }}</span>
          </summary>

          <div class="request-body">
            <ol class="stage-track" aria-label="변경 처리 단계">
              <li class="complete">
                <strong>1. 제안</strong>
                <span>변경안 생성됨</span>
              </li>
              <li :class="approvalStageClass(approval.status)">
                <strong>2. 승인</strong>
                <span>{{ approvalStageLabel(approval.status) }}</span>
              </li>
              <li :class="executionStageClass(approval.status)">
                <strong>3. 실행</strong>
                <span>{{ executionStageLabel(approval.status) }}</span>
              </li>
              <li :class="resultStageClass(approval.status)">
                <strong>4. 결과</strong>
                <span>{{ resultStageLabel(approval.status) }}</span>
              </li>
            </ol>

            <dl class="request-meta">
              <div><dt>도구</dt><dd>{{ approval.toolName }}</dd></div>
              <div><dt>요청 ID</dt><dd>{{ approval.requestId }}</dd></div>
              <div><dt>프로젝트</dt><dd>{{ approval.projectLabel }}</dd></div>
              <div><dt>요청 경로</dt><dd>{{ approval.affectedPaths.join(', ') }}</dd></div>
              <div><dt>생성</dt><dd>{{ formatDate(approval.createdAt) }}</dd></div>
              <div><dt>만료</dt><dd>{{ formatDate(approval.expiresAt) }}</dd></div>
              <div><dt>감사 상태</dt><dd>세션 메타데이터 기록</dd></div>
            </dl>

            <div class="invariant-list" aria-label="보존 규칙">
              <span>줄 수 유지</span>
              <span>구분자 유지</span>
              <span>빈 줄 유지</span>
              <span>제어 코드 유지</span>
            </div>

            <div class="preview" data-harness-approval-preview>
              <div class="preview-heading">
                <strong>전체 변경 미리보기</strong>
                <span>{{ approval.preview.serializedBytes.toLocaleString() }} bytes</span>
              </div>
              <div class="preview-table" role="table" aria-label="줄별 변경 미리보기">
                <div
                  v-for="operation in approval.preview.operations"
                  :key="operation.opId"
                  class="preview-operation"
                  role="rowgroup"
                  data-harness-approval-preview-operation
                >
                  <div class="line-number">L{{ operation.lineNumber }}</div>
                  <div class="preview-line before" role="row">
                    <span aria-label="변경 전">−</span>
                    <code>{{ operation.before }}</code>
                  </div>
                  <div class="preview-line after" role="row">
                    <span aria-label="변경 후">+</span>
                    <code>{{ operation.after }}</code>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="approval.failure" class="request-result failure" role="status">
              <strong>처리 실패 · {{ approval.failure.code }}</strong>
              <p>{{ approval.failure.message }}</p>
              <span>{{ approval.failure.retryable ? '새 제안으로 다시 시도할 수 있어요.' : '로그 확인이 필요해요.' }}</span>
            </div>
            <div v-else-if="approval.result" class="request-result success" role="status">
              <strong>변경 적용 완료</strong>
              <p>{{ approval.result.targetPath }} · {{ approval.result.operationsApplied }}개 작업</p>
            </div>
            <div v-else-if="approval.denialNote" class="request-result denied" role="status">
              <strong>거절 메모</strong>
              <p>{{ approval.denialNote }}</p>
            </div>

            <div v-if="approval.status === 'pending'" class="approval-actions">
              <label :for="`denial-${approval.approvalId}`">
                거절 메모 (선택)
                <textarea
                  :id="`denial-${approval.approvalId}`"
                  v-model="denialNotes[approval.approvalId]"
                  maxlength="500"
                  rows="2"
                  placeholder="거절 이유를 남길 수 있어요."
                />
              </label>
              <div>
                <button
                  type="button"
                  class="deny-button"
                  :disabled="busyApprovalIds.has(approval.approvalId)"
                  data-harness-approval-deny
                  @click="denyRequest(approval.approvalId)"
                >
                  거절
                </button>
                <button
                  type="button"
                  class="approve-button"
                  :disabled="busyApprovalIds.has(approval.approvalId)"
                  data-harness-approval-approve
                  @click="approveRequest(approval.approvalId)"
                >
                  {{ busyApprovalIds.has(approval.approvalId) ? '처리 중…' : '이 변경 승인' }}
                </button>
              </div>
            </div>
          </div>
        </details>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import type { MutationApprovalStatus } from '../../types/agentWorkspace'
import { useMutationApprovals } from '../composables/useMutationApprovals'

defineProps<{ focusApprovalId?: string }>()

const {
  approvals,
  pendingCount,
  loading,
  message,
  busyApprovalIds,
  approve,
  deny,
} = useMutationApprovals()
const denialNotes = reactive<Record<string, string>>({})

async function approveRequest(approvalId: string) {
  await approve(approvalId)
}

async function denyRequest(approvalId: string) {
  const result = await deny(approvalId, denialNotes[approvalId])
  if (result.ok) delete denialNotes[approvalId]
}

function statusLabel(status: MutationApprovalStatus): string {
  return {
    pending: '승인 대기',
    applying: '적용 중',
    applied: '적용 완료',
    denied: '거절됨',
    expired: '만료됨',
    stale: '원본 변경됨',
    failed: '실패',
    cancelled: '취소됨',
  }[status]
}

function sourceLabel(source: 'mcp' | 'renderer'): string {
  return source === 'mcp' ? 'MCP 제안' : '앱 제안'
}

function approvalStageClass(status: MutationApprovalStatus): string {
  if (status === 'pending') return 'current'
  if (status === 'denied' || status === 'expired' || status === 'stale' || status === 'cancelled') return 'stopped'
  return 'complete'
}

function approvalStageLabel(status: MutationApprovalStatus): string {
  if (status === 'pending') return '사용자 결정 대기'
  if (status === 'denied') return '사용자가 거절함'
  if (status === 'expired') return '승인 기한 만료'
  if (status === 'stale') return '원본 변경으로 차단'
  if (status === 'cancelled') return '세션에서 취소됨'
  return '사용자가 승인함'
}

function executionStageClass(status: MutationApprovalStatus): string {
  if (status === 'applying') return 'current'
  if (status === 'applied' || status === 'failed') return 'complete'
  return 'waiting'
}

function executionStageLabel(status: MutationApprovalStatus): string {
  if (status === 'applying') return '파일 변경 실행 중'
  if (status === 'applied' || status === 'failed') return '실행됨'
  return '실행 안 함'
}

function resultStageClass(status: MutationApprovalStatus): string {
  if (status === 'applied') return 'complete'
  if (status === 'failed') return 'stopped'
  return 'waiting'
}

function resultStageLabel(status: MutationApprovalStatus): string {
  if (status === 'applied') return '검증 완료'
  if (status === 'failed') return '안전하게 실패'
  return '결과 없음'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
</script>

<style scoped>
.approval-queue {
  flex-shrink: 0;
  padding: 14px;
  background: var(--Highlight2);
  border: 1px solid rgba(255, 190, 92, 0.38);
  border-radius: var(--radius-lg);
}
.queue-heading { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.queue-eyebrow { color: #ffc36a; font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; }
.queue-heading h2 { margin: 2px 0 4px; font-size: 15px; }
.queue-heading p:last-child { font-size: 11px; opacity: 0.75; }
.queue-summary { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; padding: 7px 10px; background: rgba(255, 190, 92, 0.1); border-radius: var(--radius-md); }
.queue-summary strong { color: #ffc36a; font-size: 18px; }
.queue-summary span { font-size: 10px; opacity: 0.8; }
.queue-empty, .queue-message { margin-top: 12px; padding: 10px; border-radius: var(--radius-md); font-size: 11px; }
.queue-empty { background: var(--Highlight1); opacity: 0.78; }
.queue-message { background: rgba(255, 156, 156, 0.12); color: #ffb3b3; }
.approval-list { display: flex; flex-direction: column; gap: 9px; margin-top: 12px; }
.approval-card { background: var(--Highlight1); border: var(--border); border-radius: var(--radius-md); overflow: hidden; scroll-margin-top: 12px; }
.approval-card:focus { outline: 2px solid #ffc36a; outline-offset: 2px; }
.approval-card.status-pending { border-color: rgba(255, 190, 92, 0.5); }
.approval-card.status-applied { border-color: rgba(95, 208, 138, 0.5); }
.approval-card.status-failed, .approval-card.status-stale { border-color: rgba(255, 156, 156, 0.5); }
summary { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 11px 12px; cursor: pointer; }
summary::marker { color: #ffc36a; }
.request-title { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; min-width: 0; }
.request-title strong { font-size: 12px; overflow-wrap: anywhere; }
.request-title > span:last-child, .request-source { font-size: 10px; opacity: 0.7; }
.status-badge { padding: 3px 7px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 10px; }
.status-pending .status-badge { color: #ffc36a; background: rgba(255, 190, 92, 0.12); }
.status-applied .status-badge { color: #7ce3a4; background: rgba(95, 208, 138, 0.12); }
.status-failed .status-badge, .status-stale .status-badge { color: #ffb3b3; background: rgba(255, 156, 156, 0.12); }
.request-body { border-top: var(--border); padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.stage-track { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); list-style: none; gap: 6px; }
.stage-track li { padding: 7px; border-radius: var(--radius-sm); background: var(--Highlight3); border-top: 2px solid rgba(255,255,255,0.15); min-width: 0; }
.stage-track strong, .stage-track span { display: block; overflow-wrap: anywhere; }
.stage-track strong { font-size: 10px; }
.stage-track span { margin-top: 2px; font-size: 9px; opacity: 0.7; }
.stage-track .complete { border-color: #5fd08a; }
.stage-track .current { border-color: #ffc36a; }
.stage-track .stopped { border-color: #ff9c9c; }
.stage-track .waiting { opacity: 0.58; }
.request-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; }
.request-meta div { min-width: 0; }
.request-meta dt { font-size: 9px; opacity: 0.58; }
.request-meta dd { margin-top: 2px; font-size: 10px; overflow-wrap: anywhere; }
.invariant-list { display: flex; flex-wrap: wrap; gap: 5px; }
.invariant-list span { padding: 3px 7px; border-radius: 999px; background: rgba(95, 208, 138, 0.1); color: #8ce5ae; font-size: 9px; }
.preview { background: #0f1018; border-radius: var(--radius-md); overflow: hidden; }
.preview-heading { display: flex; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 10px; }
.preview-heading span { opacity: 0.58; }
.preview-table { max-height: 320px; overflow: auto; }
.preview-operation { display: grid; grid-template-columns: 44px minmax(0, 1fr); border-bottom: 1px solid rgba(255,255,255,0.06); }
.preview-operation:last-child { border-bottom: 0; }
.line-number { grid-row: span 2; padding: 8px; color: #8a8f9c; background: rgba(255,255,255,0.03); font: 10px Consolas, monospace; }
.preview-line { display: grid; grid-template-columns: 18px minmax(0, 1fr); padding: 5px 8px; min-width: 0; }
.preview-line span { opacity: 0.7; }
.preview-line code { white-space: pre-wrap; overflow-wrap: anywhere; font: 10px/1.45 Consolas, 'Courier New', monospace; }
.preview-line.before { background: rgba(255, 116, 116, 0.08); color: #ffcaca; }
.preview-line.after { background: rgba(95, 208, 138, 0.08); color: #bdf3d2; }
.request-result { padding: 9px 10px; border-radius: var(--radius-md); font-size: 10px; }
.request-result p { margin-top: 3px; overflow-wrap: anywhere; }
.request-result span { display: block; margin-top: 3px; opacity: 0.72; }
.request-result.failure { background: rgba(255, 156, 156, 0.1); color: #ffb3b3; }
.request-result.success { background: rgba(95, 208, 138, 0.1); color: #9aebba; }
.request-result.denied { background: rgba(255,255,255,0.06); }
.approval-actions { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
.approval-actions label { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 9px; opacity: 0.8; }
.approval-actions textarea { resize: vertical; min-height: 48px; max-height: 120px; padding: 7px; background: #0f1018; color: var(--mainColor); border: var(--border); border-radius: var(--radius-sm); font: 10px inherit; }
.approval-actions > div { display: flex; gap: 7px; }
.approval-actions button { padding: 8px 10px; border-radius: var(--radius-sm); color: var(--mainColor); font: 11px inherit; cursor: pointer; }
.approval-actions button:disabled { opacity: 0.5; cursor: default; }
.deny-button { background: var(--Highlight3); border: var(--border); }
.approve-button { background: rgba(255, 190, 92, 0.18); border: 1px solid rgba(255, 190, 92, 0.55); }
@media (max-width: 680px) {
  .queue-heading, .approval-actions { align-items: stretch; flex-direction: column; }
  .queue-summary { align-self: flex-start; }
  .stage-track { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .request-meta { grid-template-columns: 1fr; }
  .approval-actions > div { justify-content: flex-end; }
}
</style>
