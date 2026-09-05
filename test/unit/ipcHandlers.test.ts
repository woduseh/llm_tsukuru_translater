import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../src/appContext';
import { registerTranslateHandlers } from '../../src/ipc/translateHandler';
import { registerAgentHandlers } from '../../src/ipc/agentHandler';
import { MutationApprovalRuntimeError, type MutationApprovalRuntime } from '../../src/agent/mutationApprovalRuntime';

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  handle: vi.fn(),
  send: vi.fn(),
  storageSet: vi.fn(),
  isDestroyed: vi.fn(() => false),
  existsSync: vi.fn(() => false),
  retranslateFile: vi.fn(),
  retranslateBlocks: vi.fn(),
  compareContents: { send: vi.fn() },
}));
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() }, ipcMain: { on: mocks.on, handle: mocks.handle } }));
vi.mock('fs', () => ({ default: { existsSync: mocks.existsSync } }));
vi.mock('../../src/ipc/shared', () => ({ storage: { set: mocks.storageSet } }));
vi.mock('../../src/ipc/toolsHandler', () => ({
  getLLMCompareWindow: () => ({ isDestroyed: mocks.isDestroyed, webContents: mocks.compareContents }),
}));
vi.mock('../../src/ts/rpgmv/translator.js', () => ({
  retranslateFile: mocks.retranslateFile,
  retranslateBlocks: mocks.retranslateBlocks,
}));
vi.mock('../../src/ts/libs/guidelineGenerator', () => ({ generateGuidelineDraft: vi.fn() }));
vi.mock('../../src/ts/libs/projectProfile', () => ({ scanProjectTranslationProfile: vi.fn() }));
vi.mock('../../src/logger', () => ({ default: { error: vi.fn() } }));

function handler(registrations: typeof mocks.on, channel: string) {
  const entry = registrations.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`Handler not registered: ${channel}`);
  return entry[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.compareContents.send = mocks.send;
});

describe('translation request settings IPC', () => {
  it.each([
    { workers: 8, rpm: 120, expectedWorkers: 8, expectedRpm: 120 },
    { workers: 16, rpm: 60_001, expectedWorkers: 8, expectedRpm: 60_000 },
    { workers: 1.5, rpm: -1, expectedWorkers: 1, expectedRpm: 0 },
    { workers: undefined, rpm: undefined, expectedWorkers: 1, expectedRpm: 0 },
  ])('normalizes and saves API request settings ($workers / $rpm)', ({ workers, rpm, expectedWorkers, expectedRpm }) => {
    const ctx = new AppContext();
    ctx.settings.llmModel = 'user-selected-model';
    registerTranslateHandlers(ctx);

    handler(mocks.on, 'llmSettingsApply')({}, {
      llmSortOrder: 'size-desc',
      llmParallelWorkers: workers,
      llmRequestsPerMinute: rpm,
    });

    const expected = {
      llmSortOrder: 'size-desc',
      llmParallelWorkers: expectedWorkers,
      llmRequestsPerMinute: expectedRpm,
      llmModel: 'user-selected-model',
    };
    expect(ctx.settings).toMatchObject(expected);
    expect(mocks.storageSet).toHaveBeenCalledOnce();
    expect(mocks.storageSet.mock.calls[0][0]).toBe('settings');
    expect(JSON.parse(mocks.storageSet.mock.calls[0][1])).toMatchObject(expected);
  });
});

describe('retranslation IPC', () => {
  const request = { dir: path.resolve('game'), fileName: 'Map001.txt', requestId: 'request-1', expectedContent: 'original', blockIndices: [2, 4] };

  it.each(['File', 'Blocks'] as const)('preserves %s arguments and correlates progress and completion', async (kind) => {
    const ctx = new AppContext();
    ctx.settings.llmSourceLang = 'en';
    ctx.settings.llmTargetLang = 'ko';
    mocks.existsSync.mockReturnValue(kind === 'Blocks');
    const translator = kind === 'File' ? mocks.retranslateFile : mocks.retranslateBlocks;
    translator.mockImplementation(async (...args) => {
      args[kind === 'File' ? 5 : 6]('progress');
      return { success: true };
    });
    registerTranslateHandlers(ctx);
    await handler(mocks.on, `retranslate${kind}`)({ sender: mocks.compareContents }, request);

    const args = [kind === 'File' ? path.join(request.dir, 'Extract') : path.join(request.dir, '_Extract', 'Texts'), request.fileName];
    expect(translator).toHaveBeenCalledWith(...args, ...(kind === 'Blocks' ? [request.blockIndices] : []), 'en', 'ko', ctx, expect.any(Function), 'original');
    expect(mocks.send.mock.calls).toEqual([
      ['retranslateProgress', { requestId: 'request-1', fileName: request.fileName, message: 'progress' }],
      [`retranslate${kind}Done`, { requestId: 'request-1', fileName: request.fileName, success: true }],
    ]);
  });

  it('reports a rejected translation on its corresponding completion channel', async () => {
    mocks.retranslateBlocks.mockRejectedValue(new Error('failed'));
    registerTranslateHandlers(new AppContext());
    await handler(mocks.on, 'retranslateBlocks')({ sender: mocks.compareContents }, request);
    expect(mocks.send).toHaveBeenCalledWith('retranslateBlocksDone', expect.objectContaining({ success: false, error: 'failed', requestId: 'request-1' }));
  });

  it('does not send results to a closed compare window', async () => {
    mocks.isDestroyed.mockReturnValueOnce(true);
    mocks.retranslateFile.mockResolvedValue({ success: true });
    registerTranslateHandlers(new AppContext());
    await handler(mocks.on, 'retranslateFile')({ sender: mocks.compareContents }, request);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects retranslation from another renderer', async () => {
    registerTranslateHandlers(new AppContext());
    await handler(mocks.on, 'retranslateFile')({ sender: {} }, request);
    expect(mocks.retranslateFile).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('approval IPC', () => {
  it('returns the unavailable-runtime result', async () => {
    registerAgentHandlers(new AppContext());
    expect(await handler(mocks.handle, 'mutationApprovalGet')({}, {})).toMatchObject({ schemaVersion: 1, ok: false, errorCode: 'runtime-unavailable' });
  });

  it.each(['mutationApprovalGet', 'mutationApprovalApprove'])('normalizes errors from %s', async (channel) => {
    const ctx = new AppContext();
    const error = new MutationApprovalRuntimeError('invalid-request', 'invalid request');
    ctx.mutationApprovalRuntime = {
      get: () => { throw error; },
      approve: () => Promise.reject(error),
    } as unknown as MutationApprovalRuntime;
    registerAgentHandlers(ctx);
    expect(await handler(mocks.handle, channel)({}, {})).toEqual({ schemaVersion: 1, ok: false, errorCode: 'invalid-request', message: 'invalid request' });
  });

  it('awaits approval execution and returns its result', async () => {
    const ctx = new AppContext();
    const approval = { id: 'approved' };
    ctx.mutationApprovalRuntime = { approve: vi.fn().mockResolvedValue(approval) } as unknown as MutationApprovalRuntime;
    registerAgentHandlers(ctx);
    expect(await handler(mocks.handle, 'mutationApprovalApprove')({}, {})).toEqual({ schemaVersion: 1, ok: true, approval });
  });
});

