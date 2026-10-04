// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import type { MutationApprovalRendererView } from '../../src/types/agentWorkspace';
import AgentApprovalQueue from '../../src/renderer/components/AgentApprovalQueue.vue';

const { approvals } = vi.hoisted(() => ({ approvals: [] as MutationApprovalRendererView[] }));
vi.mock('../../src/renderer/composables/useMutationApprovals', () => ({
  useMutationApprovals: () => ({
    approvals, pendingCount: 0, loading: false, message: '', busyApprovalIds: new Set(),
    approve: vi.fn(), deny: vi.fn(),
  }),
}));

let app: App | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  app?.unmount();
  host?.remove();
  approvals.length = 0;
});

function completedApproval(status: 'applied' | 'failed'): MutationApprovalRendererView {
  const common = {
    schemaVersion: 1 as const, approvalId: 'approval-1', requestId: 'request-1',
    toolName: 'patch.apply' as const, requestSource: 'renderer' as const,
    projectLabel: 'Game', affectedPaths: ['Extract/Map001.txt'],
    createdAt: '2026-10-04T00:00:00Z', expiresAt: '2026-10-04T01:00:00Z',
    preview: { schemaVersion: 1 as const, targetPath: 'Extract/Map001.txt', operations: [], serializedBytes: 10 },
    invariants: {
      schemaVersion: 1 as const, lineCountPreserved: true as const, separatorsPreserved: true as const,
      emptyLinesPreserved: true as const, controlCodesPreserved: true as const,
    },
    auditWarning: { code: 'audit-write-failed' as const, message: '감사 파일에 기록하지 못했습니다.' },
  };
  return status === 'applied'
    ? { ...common, status, result: { schemaVersion: 1, applied: true, targetPath: 'Extract/Map001.txt', operationsApplied: 1 } }
    : { ...common, status, failure: { schemaVersion: 1, code: 'write-failed', message: '변경 적용에 실패했습니다.', retryable: true } };
}

describe('approval audit warning presentation', () => {
  it.each(['applied', 'failed'] as const)('keeps the %s outcome visible alongside an audit warning', (status) => {
    approvals.push(completedApproval(status));
    host = document.createElement('div');
    document.body.append(host);
    app = createApp(AgentApprovalQueue);
    app.mount(host);
    expect(host.querySelector('[data-approval-status]')?.getAttribute('data-approval-status')).toBe(status);
    expect(host.querySelector(`.request-result.${status === 'applied' ? 'success' : 'failure'}`)?.textContent)
      .toContain(status === 'applied' ? '변경 적용 완료' : '변경 적용에 실패했습니다.');
    expect(host.querySelector('.audit-warning')?.textContent).toContain('감사 파일에 기록하지 못했습니다.');
    expect(host.querySelector('summary')?.textContent).toContain('감사 기록 경고');
    expect(host.textContent).toContain('기록 실패');
    expect(host.querySelector('[data-harness-approval-approve]')).toBeNull();
  });
});
