import * as fs from 'fs';

/**
 * Remove UTF-8 BOM (0xFEFF) from the start of a string.
 */
export function rmBom(text: string): string {
    if (text.charCodeAt(0) === 0xFEFF) {
        return text.substring(1);
    }
    return text;
}

/**
 * Read a text file with BOM handling.
 * Throws a descriptive FileIOError on failure.
 */
export function readTextFile(filePath: string, encoding: BufferEncoding = 'utf-8'): string {
    try {
        const raw = fs.readFileSync(filePath, encoding);
        return rmBom(raw);
    } catch (err) {
        throw new FileIOError(`파일을 읽을 수 없습니다: ${filePath}`, filePath, 'read', err);
    }
}

/**
 * Read and parse a JSON file with BOM handling.
 * Throws a descriptive FileIOError on failure.
 */
export function readJsonFile<T = unknown>(filePath: string): T {
    const text = readTextFile(filePath);
    try {
        return JSON.parse(text) as T;
    } catch (err) {
        throw new FileIOError(`JSON 파싱 실패: ${filePath}`, filePath, 'parse', err);
    }
}

/**
 * Write text to a file.
 * Throws a descriptive FileIOError on failure.
 */
export function writeTextFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
    try {
        fs.writeFileSync(filePath, content, encoding);
    } catch (err) {
        throw new FileIOError(`파일을 쓸 수 없습니다: ${filePath}`, filePath, 'write', err);
    }
}

/**
 * Serialize and write JSON to a file.
 * Throws a descriptive FileIOError on failure.
 */
export function writeJsonFile(filePath: string, data: unknown, indent: number | string = 2): void {
    try {
        const json = JSON.stringify(data, null, indent);
        fs.writeFileSync(filePath, json, 'utf-8');
    } catch (err) {
        throw new FileIOError(`JSON 파일을 쓸 수 없습니다: ${filePath}`, filePath, 'write', err);
    }
}

export class FileIOError extends Error {
    public readonly filePath: string;
    public readonly operation: 'read' | 'write' | 'parse';
    public readonly cause: unknown;

    constructor(message: string, filePath: string, operation: 'read' | 'write' | 'parse', cause: unknown) {
        super(message);
        this.name = 'FileIOError';
        this.filePath = filePath;
        this.operation = operation;
        this.cause = cause;
    }
}
