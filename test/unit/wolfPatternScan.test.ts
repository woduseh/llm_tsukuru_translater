import { expect, it } from 'vitest';
import { AppContext } from '../../src/appContext';
import { wolfExtractMap } from '../../src/ts/wolf/parser/Map';
import { wolfExtractMapPattern } from '../../src/ts/wolf/parser/patternBased';
import { makeWolfMap } from '../utils/wolfMapFixture';

const withTrailingBytes = (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(2048)]);

const strings = (commands: { strArg: { pos1: number; pos2: number; pos3: number; str: Buffer }[] }[]) =>
  commands.flatMap(cmd => cmd.strArg.map(arg => ({ pos1: arg.pos1, pos2: arg.pos2, pos3: arg.pos3, text: arg.str.toString('utf8') })));

it.each([2, 3] as const)('finds the same v%s event strings and byte offsets as the structured parser', async version => {
  const bytes = makeWolfMap(['Hello %1\0', 'Second\nline\0'], version);
  const structured = wolfExtractMap(bytes, new AppContext()).events.flatMap(event => event.pages.flatMap(page => page.cmd));

  const ctx = new AppContext();
  const scanned = await wolfExtractMapPattern(withTrailingBytes(bytes), ctx);

  expect(ctx.WolfMetadata.ver).toBe(version);
  expect(strings(structured)).toHaveLength(2);
  expect(strings(scanned)).toEqual(expect.arrayContaining(strings(structured)));
});

it('stops at a truncated command at the end of the map without throwing', async () => {
  const bytes = withTrailingBytes(makeWolfMap(['Hello\0'], 3));
  const truncated = Buffer.concat([bytes, Buffer.from([3, 1, 0, 0])]);

  const complete = await wolfExtractMapPattern(bytes, new AppContext());

  expect(complete.length).toBeGreaterThan(0);
  await expect(wolfExtractMapPattern(truncated, new AppContext())).resolves.toEqual(complete);
});
