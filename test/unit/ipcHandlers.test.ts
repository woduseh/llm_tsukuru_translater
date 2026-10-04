import path from 'path';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  retranslateFile: vi.fn(),
  retranslateBlocks: vi.fn(),
  compareContents: { send: vi.fn() },
  binding: null as { window: unknown; projectDir: string; isCurrent: () => boolean } | null,
}));
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() }, ipcMain: { on: mocks.on, handle: mocks.handle } }));
vi.mock('../../src/ipc/shared', () => ({ storage: { set: mocks.storageSet } }));
vi.mock('../../src/ipc/toolsHandler', () => ({
  getLLMCompareBinding: () => mocks.binding,
}));
vi.mock('../../src/ts/rpgmv/translator.js', () => ({
  retranslateFile: mocks.retranslateFile,
  retranslateBlocks: mocks.retranslateBlocks,
}));
vi.mock('../../src/ts/libs/guidelineGenerator', () => ({ generateGuidelineDraft: vi.fn() }));
vi.mock('../../src/ts/libs/projectProfile', () => ({ scanProjectTranslationProfile: vi.fn() }));
vi.mock('../../src/logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));

const roots: string[] = [];
function retranslationFixture(surface = 'Extract') {
  const parent = path.resolve('artifacts/unit/retranslationIpc');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-')); roots.push(root);
  const extractDir = path.join(root, surface);
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(`${extractDir}_backup`, { recursive: true });
  fs.writeFileSync(path.join(extractDir, 'Map001.txt'), 'original');
  fs.writeFileSync(path.join(`${extractDir}_backup`, 'Map001.txt'), 'source');
  const ctx = new AppContext();
  ctx.allowedProjectRoots = [root];
  const revision = ctx.projectSelectionRevision;
  mocks.binding = {
    window: { isDestroyed: mocks.isDestroyed, webContents: mocks.compareContents }, projectDir: root,
    isCurrent: () => !mocks.isDestroyed() && ctx.projectSelectionRevision === revision,
  };
  const request = { dir: root, fileName: 'Map001.txt', requestId: 'request-1', expectedContent: 'original', blockIndices: [2, 4] };
  return { ctx, request, extractDir };
}

function handler(registrations: typeof mocks.on, channel: string) {
  const entry = registrations.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`Handler not registered: ${channel}`);
  return entry[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDestroyed.mockReturnValue(false);
  mocks.binding = null;
  mocks.compareContents.send = mocks.send;
});
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
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
  it.each(['File', 'Blocks'] as const)('preserves %s arguments and correlates progress and completion', async (kind) => {
    const { ctx, request, extractDir } = retranslationFixture(kind === 'File' ? 'Extract' : path.join('_Extract', 'Texts'));
    ctx.settings.llmSourceLang = 'en';
    ctx.settings.llmTargetLang = 'ko';
    const translator = kind === 'File' ? mocks.retranslateFile : mocks.retranslateBlocks;
    translator.mockImplementation(async (...args) => {
      args[kind === 'File' ? 5 : 6]('progress');
      return { success: true };
    });
    registerTranslateHandlers(ctx);
    await handler(mocks.on, `retranslate${kind}`)({ sender: mocks.compareContents }, request);

    const args = [extractDir, request.fileName];
    expect(translator).toHaveBeenCalledWith(...args, ...(kind === 'Blocks' ? [request.blockIndices] : []), 'en', 'ko', ctx, expect.any(Function), 'original', expect.any(Function));
    expect(mocks.send.mock.calls).toEqual([
      ['retranslateProgress', { requestId: 'request-1', fileName: request.fileName, message: 'progress' }],
      [`retranslate${kind}Done`, { requestId: 'request-1', fileName: request.fileName, success: true }],
    ]);
  });

  it('reports a rejected translation on its corresponding completion channel', async () => {
    const { ctx, request } = retranslationFixture();
    mocks.retranslateBlocks.mockRejectedValue(new Error('failed'));
    registerTranslateHandlers(ctx);
    await handler(mocks.on, 'retranslateBlocks')({ sender: mocks.compareContents }, request);
    expect(mocks.send).toHaveBeenCalledWith('retranslateBlocksDone', expect.objectContaining({ success: false, error: 'failed', requestId: 'request-1' }));
  });

  it('does not send results to a closed compare window', async () => {
    const { ctx, request } = retranslationFixture();
    mocks.isDestroyed.mockReturnValue(true);
    mocks.retranslateFile.mockResolvedValue({ success: true });
    registerTranslateHandlers(ctx);
    await handler(mocks.on, 'retranslateFile')({ sender: mocks.compareContents }, request);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects retranslation from another renderer', async () => {
    const { ctx, request } = retranslationFixture();
    registerTranslateHandlers(ctx);
    await handler(mocks.on, 'retranslateFile')({ sender: {} }, request);
    expect(mocks.retranslateFile).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(['outside-project', 'traversal', 'missing-preimage'])('rejects %s before calling the provider', async invalid => {
    const { ctx, request } = retranslationFixture();
    const binding = mocks.binding;
    const other = retranslationFixture();
    mocks.binding = binding;
    ctx.allowedProjectRoots.push(other.request.dir);
    const bad = invalid === 'outside-project' ? { ...request, dir: other.request.dir }
      : invalid === 'traversal' ? { ...request, fileName: '../Map001.txt' }
      : { ...request, expectedContent: undefined };
    registerTranslateHandlers(ctx);
    await handler(mocks.on, 'retranslateFile')({ sender: mocks.compareContents }, bad);
    expect(mocks.retranslateFile).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith('retranslateFileDone', expect.objectContaining({ success: false }));
  });

  it('rejects an original backup linked outside the granted project', async () => {
    const { ctx, request, extractDir } = retranslationFixture();
    const binding = mocks.binding;
    const other = retranslationFixture();
    mocks.binding = binding;
    fs.renameSync(`${extractDir}_backup`, `${extractDir}_original_backup`);
    fs.symlinkSync(`${other.extractDir}_backup`, `${extractDir}_backup`, process.platform === 'win32' ? 'junction' : 'dir');
    registerTranslateHandlers(ctx);
    await handler(mocks.on, 'retranslateFile')({ sender: mocks.compareContents }, request);
    expect(mocks.retranslateFile).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith('retranslateFileDone', expect.objectContaining({ success: false }));
    expect(fs.readFileSync(path.join(`${other.extractDir}_backup`, 'Map001.txt'), 'utf8')).toBe('source');
  });

  it('passes a project-change guard to the provider and suppresses results for the replaced view', async () => {
    const { ctx, request } = retranslationFixture();
    let finish!: (result: { success: boolean }) => void;
    let current!: () => boolean;
    mocks.retranslateFile.mockImplementation((...args) => {
      current = args[7];
      return new Promise(resolve => { finish = resolve; });
    });
    registerTranslateHandlers(ctx);
    const pending = handler(mocks.on, 'retranslateFile')({ sender: mocks.compareContents }, request);
    expect(current()).toBe(true);
    ctx.projectSelectionRevision++;
    expect(current()).toBe(false);
    finish({ success: false }); await pending;
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

describe('MCP bundle setup IPC', () => {
  it.each([false, true])('copies only into the selected workspace (outside junction: %s)', linkedOutside => {
    const { ctx, request } = retranslationFixture();
    const other = retranslationFixture();
    ctx.currentTerminalProjectRoot = request.dir;
    const manifestPath = path.join(request.dir, 'manifest.json');
    fs.writeFileSync(manifestPath, '{}');
    ctx.agentBridgeServer = { isReady: () => true, manifestPath } as unknown as NonNullable<AppContext['agentBridgeServer']>;
    const destination = path.join(request.dir, '.llm-tsukuru-agent');
    const outside = path.join(other.request.dir, 'outside');
    fs.mkdirSync(outside);
    const sentinel = path.join(outside, 'mcp-agent-server.cjs');
    fs.writeFileSync(sentinel, 'outside original');
    if (linkedOutside) fs.symlinkSync(outside, destination, process.platform === 'win32' ? 'junction' : 'dir');
    const bundleSource = path.join(process.cwd(), 'res', 'mcp-agent-server.cjs');
    const originalExists = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation(candidate => String(candidate) === bundleSource || originalExists(candidate));
    const copy = vi.spyOn(fs, 'copyFileSync').mockImplementation((_source, target) => { fs.writeFileSync(target, 'fixture bundle'); });
    registerAgentHandlers(ctx);
    const result = handler(mocks.handle, 'prepareAgentMcpConnection')({});
    expect(result.ok).toBe(!linkedOutside);
    if (linkedOutside) expect(copy).not.toHaveBeenCalled();
    else expect(fs.readFileSync(path.join(destination, 'mcp-agent-server.cjs'), 'utf8')).toBe('fixture bundle');
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('outside original');
  });
});

