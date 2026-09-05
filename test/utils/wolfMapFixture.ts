import { encodeEncoding } from '../../src/utils';

// Deterministic, parseable maps for extraction/apply tests and the local benchmark.
export function makeWolfMap(strings: string[], version: 2 | 3 = 3): Buffer {
  const u32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };
  const str = (value: string) => {
    const bytes = encodeEncoding(value, { ver: version });
    return Buffer.concat([u32(bytes.length), bytes]);
  };
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70, 77, 0, version === 3 ? 85 : 0, 0, 0, 0]),
    u32(0), Buffer.from([version === 3 ? 102 : 101]), str('fixture\0'),
    u32(0), u32(1), u32(1), u32(1), // tileset, width, height, one event
    Buffer.alloc(12), // three tile layers
    Buffer.from([111]), u32(12345), u32(1), str('event\0'),
    u32(0), u32(0), u32(1), u32(0), // position, one page, no extra bytes
    Buffer.from([121]), u32(0), str('\0'), Buffer.from([0, 0, 255, 0]), // graphic
    Buffer.alloc(37), // event conditions
    Buffer.alloc(6), u32(0), // movement options and no routes
    u32(strings.length),
    ...strings.map(text => Buffer.concat([
      Buffer.from([1]), u32(101), Buffer.from([0, 1]), str(text), Buffer.from([0]),
    ])),
    u32(0), Buffer.from([122, 112, 102]), // page, event and map endings
  ]);
}

export function wolfDialogue(index: number, translated = false): string {
  const prefix = translated ? '翻訳済みの台詞' : 'こんにちは、冒険者';
  switch (index % 5) {
    case 0: return `${prefix} ${index} \\c[1]\\v[2]\n\n次の行\0`;
    case 1: return `${prefix} ${index}\n最後の行\n\0`;
    case 2: return `${prefix} ${index} %1 \\{\\}\0`;
    case 3: return '';
    default: return `${prefix} ${index}`;
  }
}
