import { expect, it } from 'vitest';
import { createEventLoopSlicer } from '../../src/ts/libs/eventLoopSlice';

it('lets queued macrotasks such as a cancel message run once the slice is used up', async () => {
  const yieldIfDue = createEventLoopSlicer(0);
  let cancelSeen = false;
  setImmediate(() => { cancelSeen = true; });

  await yieldIfDue();

  expect(cancelSeen).toBe(true);
});

it('keeps running without yielding inside the slice', async () => {
  const yieldIfDue = createEventLoopSlicer(60_000);
  let macrotaskRan = false;
  setImmediate(() => { macrotaskRan = true; });

  await yieldIfDue();

  expect(macrotaskRan).toBe(false);
});
