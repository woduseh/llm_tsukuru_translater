import { it, expect, vi } from 'vitest';
import { AppContext } from '../../src/appContext';

it('isolates mutable state and session identities between contexts', () => {
  const first = new AppContext(), second = new AppContext();
  first.allowedProjectRoots.push('/fixture');
  first.WolfCache.file = Buffer.from('fixture');
  first.llmAbort = true;
  expect(second.allowedProjectRoots).toEqual([]);
  expect(second.WolfCache).toEqual({});
  expect(second.llmAbort).toBe(false);
  expect(first.agentAppSessionId).not.toBe(second.agentAppSessionId);
});

it('disposes approval runtime state and rotates the app session on reset', async () => {
  const { AppContext } = await import('../../src/appContext');
  const ctx = new AppContext();
  const dispose = vi.fn();
  const stop = vi.fn().mockResolvedValue(undefined);
  const previousSessionId = ctx.agentAppSessionId;
  ctx.mutationApprovalRuntime = { dispose } as never;
  ctx.agentBridgeServer = { stop } as never;

  ctx.reset();

  expect(stop).toHaveBeenCalledOnce();
  expect(ctx.agentBridgeServer).toBeNull();
  expect(dispose).toHaveBeenCalledWith('context-reset');
  expect(ctx.mutationApprovalRuntime).toBeNull();
  expect(ctx.agentAppSessionId).not.toBe(previousSessionId);
});
