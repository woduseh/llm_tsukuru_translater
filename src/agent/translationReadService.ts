import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import type { JsonObject } from '../types/agentWorkspace';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { SandboxReadLimitError } from './agentFileErrors';
import { redactSecretLikeValues } from './contractsValidation';

export interface TranslationReadWindowInput {
  targetPath: string;
  sourcePath?: string;
  startLine?: number;
  count?: number;
}

export interface TranslationSearchInput {
  paths: string[];
  query: string;
  /** One-based start in the first path only; subsequent paths start at line 1. */
  startLine?: number;
  limit?: number;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
interface TextFile {
  relativePath: string;
  contentHash: string;
  byteLength: number;
  bom: boolean;
  lines: { text: string; eol: string }[];
}

/** Exact physical line access, not semantic alignment or translation quality validation. */
export class TranslationReadService {
  private readonly files: AgentSafeFileSystem;

  constructor(options: { projectRoot: string }) {
    this.files = new AgentSafeFileSystem(options);
  }

  readWindow(input: TranslationReadWindowInput): JsonObject {
    const start = integer(input.startLine, 1, Number.MAX_SAFE_INTEGER, 'startLine');
    const count = integer(input.count, 40, 200, 'count');
    const target = this.read(input.targetPath);
    const source = input.sourcePath === undefined ? null : this.read(input.sourcePath);
    const totalLines = Math.max(target.lines.length, source?.lines.length ?? 0);
    const end = Math.min(totalLines, start + count - 1);
    const rows: JsonObject[] = [];
    for (let line = start; line <= end; line += 1) {
      rows.push({ lineNumber: line, target: lineValue(target, line), ...(source ? { source: lineValue(source, line) } : {}) });
    }
    return bounded({
      schemaVersion: 1,
      alignment: 'physical-line-number-only; semantic correspondence is not verified',
      target: metadata(target),
      source: source ? metadata(source) : null,
      coverage: { kind: 'window', startLine: start, endLine: rows.length ? end : null, totalLines, truncated: false },
      nextStartLine: end < totalLines ? end + 1 : null,
      rows,
    });
  }

  search(input: TranslationSearchInput): JsonObject {
    if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 20) throw new Error('paths must contain 1 to 20 file paths');
    if (typeof input.query !== 'string' || !input.query.length || input.query.length > 500 || /[\r\n]/.test(input.query)) throw new Error('query must be a non-empty single-line literal of at most 500 characters');
    const start = integer(input.startLine, 1, Number.MAX_SAFE_INTEGER, 'startLine');
    const limit = integer(input.limit, 20, 100, 'limit');
    const matches: JsonObject[] = [];
    const inspected: JsonObject[] = [];
    let bytes = 0;
    let next: JsonObject | null = null;
    for (let fileIndex = 0; fileIndex < input.paths.length; fileIndex += 1) {
      const file = this.read(input.paths[fileIndex]);
      bytes += file.byteLength;
      if (bytes > 64 * 1024 * 1024) throw new SandboxReadLimitError('Search exceeds 64 MiB total; supply fewer paths');
      const first = fileIndex === 0 ? start : 1;
      let last = first - 1;
      for (let line = first; line <= file.lines.length; line += 1) {
        last = line;
        if (file.lines[line - 1].text.includes(input.query)) {
          matches.push({ path: file.relativePath, lineNumber: line, ...file.lines[line - 1], contentHash: file.contentHash });
          if (matches.length === limit) {
            if (line < file.lines.length) next = { paths: input.paths.slice(fileIndex), query: input.query, startLine: line + 1, limit };
            else if (fileIndex + 1 < input.paths.length) next = { paths: input.paths.slice(fileIndex + 1), query: input.query, startLine: 1, limit };
            break;
          }
        }
      }
      inspected.push({ ...metadata(file), startLine: first, endLine: last >= first ? last : null });
      if (matches.length === limit) break;
    }
    return bounded({ schemaVersion: 1, matchMode: 'case-sensitive-literal; one result per matching line', query: input.query, matches, inspected,
      coverage: { kind: next ? 'partial' : 'complete', scope: 'requested paths from startLine', truncated: false }, next });
  }

  private read(candidate: string): TextFile {
    if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('File path must be a non-empty string');
    const absolute = this.files.resolveAllowed(candidate);
    const fd = fs.openSync(absolute, 'r');
    let buffer: Buffer;
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile()) throw new Error(`Not a regular file: ${candidate}`);
      if (before.size > MAX_FILE_BYTES) throw new SandboxReadLimitError(`File exceeds 8 MiB limit: ${candidate}`);
      buffer = Buffer.alloc(before.size);
      let read = 0;
      while (read < buffer.length) {
        const size = fs.readSync(fd, buffer, read, buffer.length - read, read);
        if (size === 0) throw new Error(`File changed while reading; retry: ${candidate}`);
        read += size;
      }
      const after = fs.fstatSync(fd);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`File changed while reading; retry: ${candidate}`);
    } finally {
      fs.closeSync(fd);
    }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
    catch { throw new Error(`File is not valid UTF-8: ${candidate}`); }
    const bom = text.startsWith('\uFEFF');
    if (bom) text = text.slice(1);
    const parts = text.split('\n');
    const lines = parts.map((part, index) => {
      const terminated = index < parts.length - 1;
      const crlf = terminated && part.endsWith('\r');
      return { text: crlf ? part.slice(0, -1) : part, eol: terminated ? (crlf ? '\r\n' : '\n') : '' };
    });
    return { relativePath: path.relative(this.files.projectRoot, absolute), byteLength: buffer.length,
      contentHash: createHash('sha256').update(buffer).digest('hex'), bom, lines };
  }
}

function integer(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return result;
}

function metadata(file: TextFile): JsonObject {
  return { path: file.relativePath, contentHash: file.contentHash, hashAlgorithm: 'sha256-original-bytes', byteLength: file.byteLength, bom: file.bom, totalLines: file.lines.length };
}

function lineValue(file: TextFile, line: number): JsonObject | null {
  const value = file.lines[line - 1];
  return value ? { text: value.text, eol: value.eol } : null;
}

function bounded(result: JsonObject): JsonObject {
  const redacted = redactSecretLikeValues(result);
  const output: JsonObject = { ...redacted.value, redactions: redacted.redactions,
    textIsExact: redacted.redactions.length === 0, maxResultBytes: MAX_RESULT_BYTES };
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_RESULT_BYTES) {
    throw new SandboxReadLimitError('Result exceeds 128 KiB; reduce count/limit. A single oversized line cannot be returned by this tool. No content was silently truncated.');
  }
  return output;
}
