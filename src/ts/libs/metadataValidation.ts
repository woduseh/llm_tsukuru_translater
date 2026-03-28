import { isBoolean, isNumber, isRecord, isString } from '../../types/guards';
import type { ExtractedData, ExtractedDataEntry, ExtractedFileData } from '../rpgmv/types';

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
        type: entry.type as string,
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
