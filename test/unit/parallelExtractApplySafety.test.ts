import { describe, expect, it } from 'vitest';
import {
  validateRpgMakerParallelApplySafety,
  validateWolfParallelApplySafety,
} from '../../src/ts/libs/metadataValidation';
import { setObj } from '../../src/ts/rpgmv/extract';
import type { ExtractedData } from '../../src/ts/rpgmv/types';
import type { extData } from '../../src/ts/wolf/types';

describe('RPG Maker parallel extract/apply safety', () => {
  it('accepts non-overlapping ranges while preserving separators, control codes, and empty lines', () => {
    const text = [
      '--- 101 ---',
      'Hello \\V[1]',
      '',
      'Bye',
      '',
    ].join('\n');
    const extractedData: ExtractedData = {
      main: {
        'Maps.json': {
          outputText: text,
          data: {
            '1': {
              val: 'events.1.pages.0.list.0.parameters.0',
              m: 4,
              origin: 'Map001.json',
            },
            '4': {
              val: 'displayName',
              m: 5,
              origin: 'Map001.json',
            },
          },
        },
      },
    };

    const plan = validateRpgMakerParallelApplySafety(extractedData);

    expect(plan.byOrigin['Map001.json']).toHaveLength(2);
    expect(plan.byOrigin['Map001.json'][0]).toMatchObject({
      extractFile: 'Maps.json',
      path: 'events.1.pages.0.list.0.parameters.0',
      startLine: 1,
      endLine: 4,
    });
  });

  it('builds a per-origin plan that matches the sequential apply result', () => {
    const lines = [
      '--- 101 ---',
      'Hello \\N[1]',
      '',
      'World',
      'New map name',
    ];
    const extractedData: ExtractedData = {
      main: {
        'Maps.json': {
          data: {
            '1': {
              val: 'events.1.pages.0.list.0.parameters.0',
              m: 4,
              origin: 'Map001.json',
            },
            '4': {
              val: 'displayName',
              m: 5,
              origin: 'Map001.json',
            },
          },
        },
      },
    };
    const original = {
      displayName: '',
      events: [
        null,
        { pages: [{ list: [{ parameters: ['old'] }] }] },
      ],
    };

    let sequential = structuredClone(original);
    for (const [line, entry] of Object.entries(extractedData.main['Maps.json'].data)) {
      sequential = setObj(entry.val, collectLines(lines, Number(line), entry.m), sequential);
    }

    const plan = validateRpgMakerParallelApplySafety(extractedData, {
      extractTextLineCounts: { 'Maps.json': lines.length },
    });
    let grouped = structuredClone(original);
    for (const entry of plan.byOrigin['Map001.json']) {
      grouped = setObj(entry.path, collectLines(lines, entry.startLine, entry.endLine), grouped);
    }

    expect(grouped).toEqual(sequential);
    expect(grouped.events[1].pages[0].list[0].parameters[0]).toBe('Hello \\N[1]\n\nWorld');
  });

  it('rejects overlapping ranges for the same output origin', () => {
    const extractedData = makeRpgExtractedData({
      '1': { val: 'a', m: 3, origin: 'Map001.json' },
      '2': { val: 'b', m: 4, origin: 'Map001.json' },
    });

    expect(() => validateRpgMakerParallelApplySafety(extractedData, {
      extractTextLineCounts: { 'Maps.json': 5 },
    })).toThrow(/overlapping/);
  });

  it('rejects duplicate output paths that would race in a parallel apply', () => {
    const extractedData = makeRpgExtractedData({
      '1': { val: 'a.b', m: 2, origin: 'Map001.json' },
      '2': { val: 'a.b', m: 3, origin: 'Map001.json' },
    });

    expect(() => validateRpgMakerParallelApplySafety(extractedData, {
      extractTextLineCounts: { 'Maps.json': 4 },
    })).toThrow(/conflicting path/);
  });

  it('rejects invalid or out-of-bounds line spans', () => {
    const extractedData = makeRpgExtractedData({
      '2': { val: 'a', m: 2, origin: 'Map001.json' },
    });

    expect(() => validateRpgMakerParallelApplySafety(extractedData, {
      extractTextLineCounts: { 'Maps.json': 2 },
    })).toThrow(/invalid line span/);
  });
});

describe('Wolf parallel extract/apply safety', () => {
  it('accepts cached binary ranges whose offsets and text lines are stable', () => {
    const { ext, cache } = makeWolfFixture();

    const plan = validateWolfParallelApplySafety(ext, cache, {
      extractedTextLineCounts: { map: 3, external: 2 },
    });

    expect(plan.bySourceFile['Map001.mps']).toHaveLength(2);
    expect(plan.bySourceFile['Map001.mps'][0]).toMatchObject({
      index: 0,
      lengthOffset: 0,
      startOffset: 4,
      endOffset: 5,
    });
  });

  it('rejects stale metadata when cached bytes no longer match', () => {
    const { ext, cache } = makeWolfFixture();
    cache['Map001.mps'][4] = 90;

    expect(() => validateWolfParallelApplySafety(ext, cache)).toThrow(/cached bytes/);
  });

  it('rejects overlapping binary ranges for the same source file', () => {
    const firstHeader = Buffer.alloc(4);
    const secondHeader = Buffer.alloc(4);
    firstHeader.writeUInt32LE(4, 0);
    secondHeader.writeUInt32LE(2, 0);
    const source = Buffer.concat([firstHeader, secondHeader, Buffer.from('BC')]);
    const cache = { 'Map001.mps': source };
    const ext: extData[] = [
      {
        str: { pos1: 0, pos2: 4, pos3: 8, str: secondHeader, len: 4 },
        sourceFile: 'Map001.mps',
        extractFile: 'map',
        endsWithNull: false,
        textLineNumber: [0],
        codeStr: '101-0',
      },
      {
        str: { pos1: 4, pos2: 8, pos3: 10, str: Buffer.from('BC'), len: 2 },
        sourceFile: 'Map001.mps',
        extractFile: 'map',
        endsWithNull: false,
        textLineNumber: [1],
        codeStr: '102-0',
      },
    ];

    expect(() => validateWolfParallelApplySafety(ext, cache)).toThrow(/overlapping binary ranges/);
  });

  it('rejects non-contiguous text line metadata', () => {
    const { ext, cache } = makeWolfFixture();
    ext[0] = { ...ext[0], textLineNumber: [0, 2] };

    expect(() => validateWolfParallelApplySafety(ext, cache, {
      extractedTextLineCounts: { map: 3 },
    })).toThrow(/contiguous/);
  });
});

function collectLines(lines: string[], start: number, end: number): string {
  let output = '';
  for (let index = start; index < end; index++) {
    output += lines[index];
    if (index !== end - 1) output += '\n';
  }
  return output;
}

function makeRpgExtractedData(data: ExtractedData['main'][string]['data']): ExtractedData {
  return {
    main: {
      'Maps.json': { data },
    },
  };
}

function makeWolfFixture(): { ext: extData[]; cache: Record<string, Buffer> } {
  const first = Buffer.from('A');
  const second = Buffer.from('BC');
  const firstHeader = Buffer.alloc(4);
  const secondHeader = Buffer.alloc(4);
  firstHeader.writeUInt32LE(first.length, 0);
  secondHeader.writeUInt32LE(second.length, 0);
  const source = Buffer.concat([firstHeader, first, secondHeader, second]);

  return {
    cache: { 'Map001.mps': source },
    ext: [
      {
        str: { pos1: 0, pos2: 4, pos3: 5, str: first, len: first.length },
        sourceFile: 'Map001.mps',
        extractFile: 'map',
        endsWithNull: false,
        textLineNumber: [0],
        codeStr: '101-0',
      },
      {
        str: { pos1: 5, pos2: 9, pos3: 11, str: second, len: second.length },
        sourceFile: 'Map001.mps',
        extractFile: 'external',
        endsWithNull: false,
        textLineNumber: [1],
        codeStr: '122-0',
      },
    ],
  };
}
