import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readTextFile, writeTextFile, FileIOError } from '../../src/ts/libs/fileIO';

describe('fileIO', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileio-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
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

});
