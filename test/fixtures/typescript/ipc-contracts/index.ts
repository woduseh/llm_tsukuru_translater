import type {
  ElectronApi, SendChannel, InvokeChannel, ReceiveChannel,
  SEND_CHANNELS, INVOKE_CHANNELS, RECEIVE_CHANNELS,
} from '../../../../src/types/ipc';
import type { TerminalOperationResult } from '../../../../src/types/agentWorkspace';
import { api, useIpcOn } from '../../../../src/renderer/composables/useIpc';

declare const preloadApi: ElectronApi;

// The implementation and renderer expose the same interface, without widening.
const rendererApi: typeof api = preloadApi;
rendererApi.send('openLLMCompare', '/game');
rendererApi.send('compareReady');
rendererApi.send('compareReady', { fresh: true });
rendererApi.send('retranslateFile', {
  dir: '/game', fileName: 'Map001.txt', requestId: 'review-1', expectedContent: 'before',
});
const sessions: Promise<TerminalOperationResult> = rendererApi.invoke('terminalList');
const helperSessions: typeof sessions = rendererApi.terminal.list();
void helperSessions;

async function consumeInferredResults() {
  const status = await api.invoke('getAgentWorkspaceStatus');
  const selected: boolean = status.project.selected;
  const detection = await api.invoke('detectAgentExecutables', [{ id: 'codex', executableNames: ['codex.cmd'] }]);
  const id: string = detection.results[0].id;
  const saved = await api.invoke('compareSaveText', {
    projectDir: '/game', fileName: 'Map001.txt', targetPath: '/game/Extract/Map001.txt',
    expectedContent: 'before', nextContent: 'after',
  });
  const success: boolean = saved.success;
  // @ts-expect-error Results must remain typed rather than any.
  const wrong: string = saved.success;
  return { selected, id, success, wrong };
}
void consumeInferredResults;

api.on('loading', (progress) => {
  const percent: number = progress;
  // @ts-expect-error A progress event carries a number, not an arbitrary object.
  progress.current;
  void percent;
});
useIpcOn('verifyApplyJsonDone', (result) => {
  const requestId: string = result.requestId;
  const success: boolean = result.success;
  // @ts-expect-error The main-to-renderer payload has no nextContent field.
  result.nextContent;
  void requestId;
  void success;
});

// @ts-expect-error Misspelled channels must not enter the preload interface.
api.send('openLLMCompar', '/game');
// @ts-expect-error Invoke-only channels cannot be sent as events.
api.send('terminalList');
// @ts-expect-error Send-only channels cannot be invoked.
api.invoke('openLLMCompare', '/game');
// @ts-expect-error Receive-only channels cannot be sent to main.
api.send('loading', 50);
// @ts-expect-error Required project argument is missing.
api.send('openLLMCompare');
// @ts-expect-error Required reviewed preimage is missing.
api.send('retranslateFile', { dir: '/game', fileName: 'Map001.txt', requestId: 'review-1' });
// @ts-expect-error Request/reply payloads are required as well.
api.invoke('mutationApprovalApprove');
// @ts-expect-error The approval helper uses the same request shape.
api.approvals.approve({ schemaVersion: 1 });
// @ts-expect-error Wrong known payload type must not widen the channel.
api.send('setheight', '700');
// @ts-expect-error Subscriptions only accept main-to-renderer channels.
useIpcOn('openLLMCompare', () => {});
// @ts-expect-error Subscription callback must match the channel payload.
api.once('loading', (value: string) => { void value; });

type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
// Security allowlists and compile contracts must cover exactly the same channels.
type SendAllowlistComplete = Assert<Same<SendChannel, typeof SEND_CHANNELS[number]>>;
type InvokeAllowlistComplete = Assert<Same<InvokeChannel, typeof INVOKE_CHANNELS[number]>>;
type ReceiveAllowlistComplete = Assert<Same<ReceiveChannel, typeof RECEIVE_CHANNELS[number]>>;
export type AllowlistChecks = SendAllowlistComplete | InvokeAllowlistComplete | ReceiveAllowlistComplete;

// The same transport must not erase state-specific effect contracts.
import type { TranslationOutcome, TranslationRunLog } from '../../../../src/ts/libs/translationResult';
import type { MutationApprovalState } from '../../../../src/types/agentWorkspace';
import type { MutationApprovalRecord } from '../../../../src/agent/mutationApprovalContracts';
import type { createMutationPatchExecutor } from '../../../../src/agent/mutationPatchExecutor';
declare const outcome: TranslationOutcome;
declare const runLog: TranslationRunLog;
if (outcome.status === 'translated' || outcome.status === 'skipped') {
  const content: string = outcome.translatedContent;
  void content;
}
// @ts-expect-error Failed/cancelled output cannot be saved without narrowing.
outcome.translatedContent;
// @ts-expect-error A failed translation needs a reason and cannot masquerade as success.
const failedTranslation: TranslationOutcome = { status: 'failed', validation: [], logEntry: runLog };
// @ts-expect-error Applied approvals always carry their verified effect result.
const appliedWithoutResult: MutationApprovalState = { status: 'applied' };
// @ts-expect-error A failed approval must explain the failure.
const failedWithoutReason: MutationApprovalState = { status: 'failed' };
declare const execute: ReturnType<typeof createMutationPatchExecutor>;
declare const pendingApproval: MutationApprovalRecord & { status: 'pending' };
// @ts-expect-error A pending proposal is not an approval claimed for execution.
execute(pendingApproval);
void failedTranslation;
void appliedWithoutResult;
void failedWithoutReason;
