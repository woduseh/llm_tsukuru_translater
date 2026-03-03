import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readTextFile, readJsonFile, writeTextFile, writeJsonFile, rmBom, FileIOError } from '../../src/ts/libs/fileIO';

describe('fileIO', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileio-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('rmBom', () => {
        it('removes BOM from string', () => {
            expect(rmBom('\uFEFFhello')).toBe('hello');
        });

        it('returns string unchanged if no BOM', () => {
            expect(rmBom('hello')).toBe('hello');
        });

        it('handles empty string', () => {
            expect(rmBom('')).toBe('');
        });
    });

    describe('readTextFile', () => {
        it('reads a plain text file', () => {
            const file = path.join(tmpDir, 'test.txt');
            fs.writeFileSync(file, 'hello world', 'utf-8');
            expect(readTextFile(file)).toBe('hello world');
        });

        it('strips BOM from file content', () => {
            const file = path.join(tmpDir, 'bom.txt');
            fs.writeFileSync(file, '\uFEFFhello', 'utf-8');
            expect(readTextFile(file)).toBe('hello');
        });

        it('throws FileIOError for non-existent file', () => {
            const file = path.join(tmpDir, 'nonexistent.txt');
            expect(() => readTextFile(file)).toThrow(FileIOError);
            try {
                readTextFile(file);
            } catch (e) {
                const err = e as FileIOError;
                expect(err.operation).toBe('read');
                expect(err.filePath).toBe(file);
            }
        });
    });

    describe('readJsonFile', () => {
        it('reads and parses JSON file', () => {
            const file = path.join(tmpDir, 'data.json');
            fs.writeFileSync(file, '{"key": "value"}', 'utf-8');
            expect(readJsonFile(file)).toEqual({ key: 'value' });
        });

        it('handles JSON with BOM', () => {
            const file = path.join(tmpDir, 'bom.json');
            fs.writeFileSync(file, '\uFEFF{"a": 1}', 'utf-8');
            expect(readJsonFile(file)).toEqual({ a: 1 });
        });

        it('throws FileIOError for invalid JSON', () => {
            const file = path.join(tmpDir, 'bad.json');
            fs.writeFileSync(file, '{invalid json}', 'utf-8');
            expect(() => readJsonFile(file)).toThrow(FileIOError);
            try {
                readJsonFile(file);
            } catch (e) {
                expect((e as FileIOError).operation).toBe('parse');
            }
        });

        it('throws FileIOError for missing file', () => {
            expect(() => readJsonFile(path.join(tmpDir, 'missing.json'))).toThrow(FileIOError);
        });
    });

    describe('writeTextFile', () => {
        it('writes text to file', () => {
            const file = path.join(tmpDir, 'out.txt');
            writeTextFile(file, 'content');
            expect(fs.readFileSync(file, 'utf-8')).toBe('content');
        });

        it('throws FileIOError on write failure', () => {
            const badPath = path.join(tmpDir, 'nonexistent-dir', 'file.txt');
            expect(() => writeTextFile(badPath, 'data')).toThrow(FileIOError);
        });
    });

    describe('writeJsonFile', () => {
        it('writes JSON to file', () => {
            const file = path.join(tmpDir, 'out.json');
            writeJsonFile(file, { key: 'value' });
            const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
            expect(content).toEqual({ key: 'value' });
        });

        it('uses specified indent', () => {
            const file = path.join(tmpDir, 'indent.json');
            writeJsonFile(file, { a: 1 }, 4);
            const raw = fs.readFileSync(file, 'utf-8');
            expect(raw).toContain('    "a"');
        });

        it('throws FileIOError on write failure', () => {
            const badPath = path.join(tmpDir, 'nonexistent-dir', 'file.json');
            expect(() => writeJsonFile(badPath, {})).toThrow(FileIOError);
        });
    });
});
