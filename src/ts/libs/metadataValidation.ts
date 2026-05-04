import { isBoolean, isNumber, isRecord, isString } from '../../types/guards';
import type { ExtractedData, ExtractedDataEntry, ExtractedFileData } from '../rpgmv/types';
import type { extData, wolfMetadata } from '../wolf/types';

export interface RpgMakerApplyEntryPlan {
  extractFile: string;
  originFile: string;
  path: string;
  startLine: number;
  endLine: number;
  entry: ExtractedDataEntry;
}

export interface RpgMakerParallelApplyPlan {
  entries: RpgMakerApplyEntryPlan[];
  byOrigin: Record<string, RpgMakerApplyEntryPlan[]>;
}

export interface RpgMakerApplySafetyOptions {
  extractTextLineCounts?: Record<string, number>;
}

export interface WolfApplyEntryPlan {
  index: number;
  sourceFile: string;
  extractFile: string;
  startOffset: number;
  lengthOffset: number;
  endOffset: number;
  textLineNumbers: number[];
  entry: extData;
}

export interface WolfParallelApplyPlan {
  entries: WolfApplyEntryPlan[];
  bySourceFile: Record<string, WolfApplyEntryPlan[]>;
}

export interface WolfApplySafetyOptions {
  extractedTextLineCounts?: Record<string, number>;
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function assertInteger(value: unknown, path: string): number {
  if (!isNumber(value) || !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer`);
  }
  return value;
}

function assertString(value: unknown, path: string): string {
  if (!isString(value)) {
    throw new Error(`${path} must be a string`);
  }
  return value;
}

function assertBinary(value: unknown, path: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${path} must be binary data`);
  }
  return value;
}

export function validateExtractedData(value: unknown): ExtractedData {
  const root = assertRecord(value, '.extracteddata');
  const main = assertRecord(root.main, '.extracteddata.main');
  const normalizedMain: Record<string, ExtractedFileData> = {};

  for (const [fileName, fileValue] of Object.entries(main)) {
    const fileRecord = assertRecord(fileValue, `.extracteddata.main.${fileName}`);
    const dataRecord = assertRecord(fileRecord.data, `.extracteddata.main.${fileName}.data`);
    const normalizedData: Record<string, ExtractedDataEntry> = {};

    for (const [lineNumber, entryValue] of Object.entries(dataRecord)) {
      const line = assertInteger(Number(lineNumber), `.extracteddata.main.${fileName}.data key`);
      const entry = assertRecord(entryValue, `.extracteddata.main.${fileName}.data.${lineNumber}`);
      const endLine = assertInteger(entry.m, `.extracteddata.main.${fileName}.data.${lineNumber}.m`);
      if (endLine < line) {
        throw new Error(`.extracteddata.main.${fileName}.data.${lineNumber}.m must be >= ${line}`);
      }

      if (entry.origin !== undefined && !isString(entry.origin)) {
        throw new Error(`.extracteddata.main.${fileName}.data.${lineNumber}.origin must be a string`);
      }

      if (entry.conf !== undefined && !isRecord(entry.conf)) {
        throw new Error(`.extracteddata.main.${fileName}.data.${lineNumber}.conf must be an object`);
      }

      if (entry.type !== undefined && !isString(entry.type)) {
        throw new Error(`.extracteddata.main.${fileName}.data.${lineNumber}.type must be a string`);
      }

      if (entry.originText !== undefined && !isString(entry.originText)) {
        throw new Error(`.extracteddata.main.${fileName}.data.${lineNumber}.originText must be a string`);
      }

      normalizedData[lineNumber] = {
        val: assertString(entry.val, `.extracteddata.main.${fileName}.data.${lineNumber}.val`),
        m: endLine,
        origin: entry.origin as string | undefined,
        conf: entry.conf as ExtractedDataEntry['conf'],
        type: entry.type,
        originText: entry.originText as string | undefined,
      };
    }

    if (fileRecord.isbom !== undefined && !isBoolean(fileRecord.isbom)) {
      throw new Error(`.extracteddata.main.${fileName}.isbom must be a boolean`);
    }

    if (fileRecord.outputText !== undefined && !isString(fileRecord.outputText)) {
      throw new Error(`.extracteddata.main.${fileName}.outputText must be a string`);
    }

    normalizedMain[fileName] = {
      data: normalizedData,
      isbom: fileRecord.isbom as boolean | undefined,
      outputText: fileRecord.outputText as string | undefined,
    };
  }

  return { main: normalizedMain };
}

export function validateRpgMakerParallelApplySafety(
  extractedData: ExtractedData,
  options: RpgMakerApplySafetyOptions = {},
): RpgMakerParallelApplyPlan {
  const entries: RpgMakerApplyEntryPlan[] = [];
  const byOrigin: Record<string, RpgMakerApplyEntryPlan[]> = {};
  const rangesByOriginAndExtract = new Map<string, RpgMakerApplyEntryPlan[]>();
  const pathsByOrigin = new Map<string, Map<string, RpgMakerApplyEntryPlan>>();

  for (const [extractFile, fileData] of Object.entries(extractedData.main)) {
    const inferredLineCount = fileData.outputText === undefined ? undefined : countSplitLines(fileData.outputText);
    const lineCount = options.extractTextLineCounts?.[extractFile] ?? inferredLineCount;

    for (const [lineKey, entry] of Object.entries(fileData.data)) {
      const startLine = Number(lineKey);
      if (!Number.isInteger(startLine) || startLine < 0) {
        throw new Error(`unsafe RPG Maker apply metadata: ${extractFile}.${lineKey} line key must be a non-negative integer`);
      }
      if (!Number.isInteger(entry.m) || entry.m <= startLine) {
        throw new Error(`unsafe RPG Maker apply metadata: ${extractFile}.${lineKey} has invalid line span ${startLine}-${entry.m}`);
      }
      if (lineCount !== undefined && entry.m > lineCount) {
        throw new Error(`unsafe RPG Maker apply metadata: ${extractFile}.${lineKey} span ${startLine}-${entry.m} exceeds ${lineCount} text lines`);
      }
      if (entry.val.length === 0) {
        throw new Error(`unsafe RPG Maker apply metadata: ${extractFile}.${lineKey} path must not be empty`);
      }

      const originFile = entry.origin ?? extractFile;
      const planEntry: RpgMakerApplyEntryPlan = {
        extractFile,
        originFile,
        path: entry.val,
        startLine,
        endLine: entry.m,
        entry,
      };

      const originPaths = pathsByOrigin.get(originFile) ?? new Map<string, RpgMakerApplyEntryPlan>();
      const existingPath = originPaths.get(entry.val);
      if (existingPath !== undefined) {
        throw new Error(`unsafe RPG Maker apply metadata: ${originFile} has conflicting path ${entry.val} at ${existingPath.extractFile}:${existingPath.startLine} and ${extractFile}:${startLine}`);
      }
      originPaths.set(entry.val, planEntry);
      pathsByOrigin.set(originFile, originPaths);

      const rangeKey = `${originFile}\0${extractFile}`;
      const ranges = rangesByOriginAndExtract.get(rangeKey) ?? [];
      ranges.push(planEntry);
      rangesByOriginAndExtract.set(rangeKey, ranges);

      entries.push(planEntry);
      (byOrigin[originFile] ??= []).push(planEntry);
    }
  }

  for (const ranges of rangesByOriginAndExtract.values()) {
    ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    for (let index = 1; index < ranges.length; index++) {
      const previous = ranges[index - 1];
      const current = ranges[index];
      if (current.startLine < previous.endLine) {
        throw new Error(`unsafe RPG Maker apply metadata: ${current.originFile} has overlapping ${current.extractFile} ranges ${previous.startLine}-${previous.endLine} and ${current.startLine}-${current.endLine}`);
      }
    }
  }

  for (const originEntries of Object.values(byOrigin)) {
    originEntries.sort((a, b) => a.extractFile.localeCompare(b.extractFile) || a.startLine - b.startLine);
  }

  return { entries, byOrigin };
}

export function validateWolfExtDataPayload(value: unknown): {
  ext: extData[];
  meta: wolfMetadata;
  cache: Record<string, Buffer>;
} {
  const root = assertRecord(value, 'wolf extracted data');
  if (!Array.isArray(root.ext)) {
    throw new Error('wolf extracted data.ext must be an array');
  }

  const meta = assertRecord(root.meta, 'wolf extracted data.meta');
  const ver = meta.ver;
  if (ver !== 2 && ver !== 3 && ver !== -1) {
    throw new Error('wolf extracted data.meta.ver must be 2, 3, or -1');
  }

  const cacheRecord = assertRecord(root.cache, 'wolf extracted data.cache');
  const cache: Record<string, Buffer> = {};
  for (const [fileName, entry] of Object.entries(cacheRecord)) {
    cache[fileName] = Buffer.from(assertBinary(entry, `wolf extracted data.cache.${fileName}`));
  }

  const ext = root.ext.map((entry, index) => {
    const entryRecord = assertRecord(entry, `wolf extracted data.ext.${index}`);
    const strRecord = assertRecord(entryRecord.str, `wolf extracted data.ext.${index}.str`);

    if (!Array.isArray(entryRecord.textLineNumber) || !entryRecord.textLineNumber.every((line) => isNumber(line) && Number.isInteger(line))) {
      throw new Error(`wolf extracted data.ext.${index}.textLineNumber must be an integer array`);
    }

    return {
      str: {
        pos1: assertInteger(strRecord.pos1, `wolf extracted data.ext.${index}.str.pos1`),
        pos2: assertInteger(strRecord.pos2, `wolf extracted data.ext.${index}.str.pos2`),
        pos3: assertInteger(strRecord.pos3, `wolf extracted data.ext.${index}.str.pos3`),
        str: assertBinary(strRecord.str, `wolf extracted data.ext.${index}.str.str`),
        len: assertInteger(strRecord.len, `wolf extracted data.ext.${index}.str.len`),
      },
      sourceFile: assertString(entryRecord.sourceFile, `wolf extracted data.ext.${index}.sourceFile`),
      extractFile: assertString(entryRecord.extractFile, `wolf extracted data.ext.${index}.extractFile`),
      endsWithNull: entryRecord.endsWithNull === true,
      textLineNumber: [...entryRecord.textLineNumber] as number[],
      codeStr: assertString(entryRecord.codeStr, `wolf extracted data.ext.${index}.codeStr`),
    } satisfies extData;
  });

  return {
    ext,
    meta: { ver },
    cache,
  };
}

export function validateWolfParallelApplySafety(
  ext: extData[],
  cache: Record<string, Buffer>,
  options: WolfApplySafetyOptions = {},
): WolfParallelApplyPlan {
  const entries: WolfApplyEntryPlan[] = [];
  const bySourceFile: Record<string, WolfApplyEntryPlan[]> = {};

  for (let index = 0; index < ext.length; index++) {
    const entry = ext[index];
    if (entry.sourceFile.length === 0) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index}.sourceFile must not be empty`);
    }
    if (entry.extractFile.length === 0) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index}.extractFile must not be empty`);
    }

    const source = cache[entry.sourceFile];
    if (!Buffer.isBuffer(source)) {
      throw new Error(`unsafe Wolf apply metadata: missing cached binary for ${entry.sourceFile}`);
    }

    const { pos1, pos2, pos3, len } = entry.str;
    if (pos1 < 0 || pos2 < 0 || pos3 < 0 || len < 0 || pos1 + 4 !== pos2 || pos2 > pos3) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index} has invalid offsets ${pos1}-${pos2}-${pos3}`);
    }
    if (pos3 > source.length) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index} range ${pos1}-${pos3} exceeds ${source.length} bytes`);
    }
    if (pos3 - pos2 !== len) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index} length ${len} does not match offset range`);
    }
    if (source.readUInt32LE(pos1) !== len) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index} cached length header does not match metadata`);
    }
    if (!source.subarray(pos2, pos3).equals(Buffer.from(entry.str.str))) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index} cached bytes do not match metadata bytes`);
    }

    validateWolfTextLines(index, entry, options.extractedTextLineCounts?.[entry.extractFile]);

    const planEntry: WolfApplyEntryPlan = {
      index,
      sourceFile: entry.sourceFile,
      extractFile: entry.extractFile,
      startOffset: pos2,
      lengthOffset: pos1,
      endOffset: pos3,
      textLineNumbers: [...entry.textLineNumber],
      entry,
    };
    entries.push(planEntry);
    (bySourceFile[entry.sourceFile] ??= []).push(planEntry);
  }

  for (const sourceEntries of Object.values(bySourceFile)) {
    sourceEntries.sort((a, b) => a.lengthOffset - b.lengthOffset || a.endOffset - b.endOffset);
    for (let index = 1; index < sourceEntries.length; index++) {
      const previous = sourceEntries[index - 1];
      const current = sourceEntries[index];
      if (current.lengthOffset < previous.endOffset) {
        throw new Error(`unsafe Wolf apply metadata: ${current.sourceFile} has overlapping binary ranges ${previous.lengthOffset}-${previous.endOffset} and ${current.lengthOffset}-${current.endOffset}`);
      }
    }
  }

  return { entries, bySourceFile };
}

function countSplitLines(text: string): number {
  return text.split('\n').length;
}

function validateWolfTextLines(index: number, entry: extData, lineCount: number | undefined): void {
  if (entry.textLineNumber.length === 0) {
    throw new Error(`unsafe Wolf apply metadata: ext.${index}.textLineNumber must not be empty`);
  }
  const firstLine = entry.textLineNumber[0];
  if (!Number.isInteger(firstLine) || firstLine < 0) {
    throw new Error(`unsafe Wolf apply metadata: ext.${index}.textLineNumber must contain non-negative integers`);
  }
  for (let lineIndex = 0; lineIndex < entry.textLineNumber.length; lineIndex++) {
    const lineNumber = entry.textLineNumber[lineIndex];
    if (!Number.isInteger(lineNumber) || lineNumber < 0) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index}.textLineNumber must contain non-negative integers`);
    }
    if (lineNumber !== firstLine + lineIndex) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index}.textLineNumber must be contiguous`);
    }
    if (lineCount !== undefined && lineNumber >= lineCount) {
      throw new Error(`unsafe Wolf apply metadata: ext.${index}.textLineNumber ${lineNumber} exceeds ${lineCount} text lines`);
    }
  }
}
