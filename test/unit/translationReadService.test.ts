import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { TranslationReadService, type TranslationSearchInput } from '../../src/agent/translationReadService';

const sandbox = path.resolve('artifacts', 'unit', 'translationReadService');
let root: string;
let service: TranslationReadService;

beforeEach(() => {
  fs.mkdirSync(sandbox, { recursive: true });
  root = fs.mkdtempSync(path.join(sandbox, 'read-'));
  service = new TranslationReadService({ projectRoot: root });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function write(name: string, content: string | Buffer): string {
  fs.writeFileSync(path.join(root, name), content);
  return name;
}

describe('MCP exact translation reading', () => {
  it('preserves blank lines, CRLF, control codes, BOM metadata and original-byte hash', () => {
    const text = '\uFEFFこんにちは\r\n\r\n\\C[1]---\n';
    const targetPath = write('target.txt', text);
    const result = service.readWindow({ targetPath });
    expect(result.rows).toEqual([
      { lineNumber: 1, target: { text: 'こんにちは', eol: '\r\n' } },
      { lineNumber: 2, target: { text: '', eol: '\r\n' } },
      { lineNumber: 3, target: { text: '\\C[1]---', eol: '\n' } },
      { lineNumber: 4, target: { text: '', eol: '' } },
    ]);
    expect(result.target).toMatchObject({ bom: true, totalLines: 4, contentHash: createHash('sha256').update(text).digest('hex') });
    expect(result.textIsExact).toBe(true);
  });

  it('reads later windows beyond the old prefix limit and represents missing paired lines as null', () => {
    const targetPath = write('target.txt', `${'a'.repeat(300000)}\n둘째\n셋째`);
    const sourcePath = write('source.txt', 'first\nsecond');
    const result = service.readWindow({ targetPath, sourcePath, startLine: 2, count: 1 });
    expect(result.rows).toEqual([{ lineNumber: 2, source: { text: 'second', eol: '' }, target: { text: '둘째', eol: '\n' } }]);
    expect(result.nextStartLine).toBe(3);
    expect(service.readWindow({ targetPath, sourcePath, startLine: 3 }).rows).toEqual([
      { lineNumber: 3, source: null, target: { text: '셋째', eol: '' } },
    ]);
    expect(result.alignment).toContain('semantic correspondence is not verified');
  });

  it('handles empty and out-of-range windows without inventing line contents', () => {
    const targetPath = write('empty.txt', '');
    expect(service.readWindow({ targetPath }).rows).toEqual([{ lineNumber: 1, target: { text: '', eol: '' } }]);
    expect(service.readWindow({ targetPath, startLine: 50 })).toMatchObject({ rows: [], nextStartLine: null, coverage: { endLine: null } });
  });

  it('rejects invalid UTF-8, oversized files and oversized lines explicitly', () => {
    expect(() => service.readWindow({ targetPath: write('bad.txt', Buffer.from([0xc3, 0x28])) })).toThrow('not valid UTF-8');
    expect(() => service.readWindow({ targetPath: write('huge.txt', Buffer.alloc(8 * 1024 * 1024 + 1)) })).toThrow('8 MiB');
    expect(() => service.readWindow({ targetPath: write('long.txt', 'x'.repeat(140000)) })).toThrow('No content was silently truncated');
  });

  it('rejects path escapes and invalid bounds', () => {
    expect(() => service.readWindow({ targetPath: '../outside.txt' })).toThrow('escapes allowed roots');
    const targetPath = write('target.txt', 'text');
    for (const count of [0, -1, 201, 1.5, NaN]) expect(() => service.readWindow({ targetPath, count })).toThrow('count must');
  });

  it('redacts secret-like content and explicitly marks text as changed', () => {
    const result = service.readWindow({ targetPath: write('target.txt', 'api_key=abcdefghijklmnopqrstuvwxyz1234567890') });
    expect(JSON.stringify(result.rows)).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result.textIsExact).toBe(false);
    expect(result.redactions).not.toEqual([]);
  });

  it('searches literal text and pages across files without skipping or duplicating matches', () => {
    const paths = [write('one.txt', 'skip\n[hero]\n[hero]\nno'), write('two.txt', '[hero]\nHero')];
    const first = service.search({ paths, query: '[hero]', startLine: 2, limit: 1 });
    expect(first.matches).toMatchObject([{ path: 'one.txt', lineNumber: 2, text: '[hero]' }]);
    expect(first.coverage).toMatchObject({ kind: 'partial' });
    const second = service.search(first.next as unknown as TranslationSearchInput);
    expect(second.matches).toMatchObject([{ path: 'one.txt', lineNumber: 3 }]);
    const third = service.search(second.next as unknown as TranslationSearchInput);
    expect(third.matches).toMatchObject([{ path: 'two.txt', lineNumber: 1 }]);
    const last = service.search(third.next as unknown as TranslationSearchInput);
    expect(last).toMatchObject({ matches: [], next: null, coverage: { kind: 'complete' } });
  });

  it('search returns complete coverage for no matches and rejects multiline queries', () => {
    const paths = [write('one.txt', 'Alpha\nBeta')];
    expect(service.search({ paths, query: 'alpha' })).toMatchObject({ matches: [], next: null, coverage: { kind: 'complete' } });
    expect(() => service.search({ paths, query: 'Alpha\nBeta' })).toThrow('single-line');
    expect(() => service.search({ paths: [], query: 'x' })).toThrow('1 to 20');
  });
});
