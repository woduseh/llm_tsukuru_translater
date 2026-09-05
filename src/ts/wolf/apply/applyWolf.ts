import fs from 'fs';
import path from 'path';
import Tools from '../../libs/projectTools';
import WolfExtDataParser from '../extract/wolfExtData';
import { readTextFile } from '../../libs/fileIO';
import { validateWolfParallelApplySafety, type WolfParallelApplyPlan } from '../../libs/metadataValidation';
import { AppContext } from '../../../appContext';
import type { extData } from '../types';
import type { ResolvedWolfSource, WolfProjectPaths } from '../paths';
import { resolveWolfExtractRootForApply, resolveWolfSourceFile } from '../paths';
import { decodeEncoding, encodeEncoding } from '../../../utils';

interface NormalizedWolfSources {
  ext: extData[];
  cache: Record<string, Buffer>;
  diskPaths: Record<string, string>;
}

interface PreparedWolfOutput {
  sourceFile: string;
  diskPath: string;
  original: Buffer;
  output: Buffer;
  mode: number;
}

interface StagedWolfOutput extends PreparedWolfOutput {
  stagedPath: string;
  backupPath: string;
  displacedPath: string;
}

const WOLF_CONTROL_CODE_REGEX = /\\\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[{}$|.!><^])|%[0-9]/g;

export async function wolfAppyier(ctx: AppContext, paths: WolfProjectPaths) {
  const extractRoot = resolveWolfExtractRootForApply(paths);
  const metadataPath = path.join(extractRoot, '.extracteddata');
  WolfExtDataParser.read(metadataPath, ctx);
  if (ctx.WolfMetadata.ver !== 2 && ctx.WolfMetadata.ver !== 3) {
    throw new Error('Wolf 추출 메타데이터의 버전을 확인할 수 없습니다. 다시 추출해주세요.');
  }

  const normalized = normalizeWolfSources(ctx.WolfExtData, ctx.WolfCache, paths);
  ctx.WolfExtData = normalized.ext;
  ctx.WolfCache = normalized.cache;

  const extractedTexts = readExtractedTexts(extractRoot, normalized.ext);
  const extractedTextLineCounts = Object.fromEntries(
    Object.entries(extractedTexts).map(([name, lines]) => [name, lines.length]),
  );

  const plan = validateWolfParallelApplySafety(normalized.ext, normalized.cache, {
    extractedTextLineCounts,
  });
  const replacements = preflightWolfTexts(plan, extractedTexts, ctx);
  const outputs = prepareWolfOutputs(plan, normalized, replacements);

  commitWolfOutputsTransaction(outputs);
  if (ctx.mainWindow) {
    Tools.setProgress(1, 1);
    Tools.setProgress(0, 1);
  }
}

export function normalizeWolfSources(
  ext: extData[],
  cache: Record<string, Buffer>,
  paths: WolfProjectPaths,
): NormalizedWolfSources {
  const normalizedCache: Record<string, Buffer> = {};
  const diskPaths: Record<string, string> = {};
  // This normalization is synchronous. Resolve each raw path once within this
  // call; aliases still pass the resolver and later applies revalidate the disk.
  const resolvedSources = new Map<string, ResolvedWolfSource>();
  const resolveSource = (sourceFile: string): ResolvedWolfSource => {
    let resolved = resolvedSources.get(sourceFile);
    if (!resolved) {
      resolved = resolveWolfSourceFile(paths, sourceFile);
      resolvedSources.set(sourceFile, resolved);
    }
    return resolved;
  };

  for (const [sourceFile, bytes] of Object.entries(cache)) {
    const resolved = resolveSource(sourceFile);
    const existing = normalizedCache[resolved.sourceFile];
    const normalizedBytes = Buffer.from(bytes);
    if (existing && !existing.equals(normalizedBytes)) {
      throw new Error(`Wolf cache 경로가 충돌합니다: ${sourceFile}`);
    }
    normalizedCache[resolved.sourceFile] = normalizedBytes;
    diskPaths[resolved.sourceFile] = resolved.diskPath;
  }

  const normalizedExt = ext.map((entry) => {
    const resolved = resolveSource(entry.sourceFile);
    diskPaths[resolved.sourceFile] = resolved.diskPath;
    return {
      ...entry,
      sourceFile: resolved.sourceFile,
      str: {
        ...entry.str,
        str: Buffer.from(entry.str.str),
      },
      textLineNumber: [...entry.textLineNumber],
    };
  });

  return { ext: normalizedExt, cache: normalizedCache, diskPaths };
}

function readExtractedTexts(extractRoot: string, ext: extData[]): Record<string, string[]> {
  const textsRoot = path.join(extractRoot, 'Texts');
  const result: Record<string, string[]> = {};
  for (const extractFile of new Set(ext.map((entry) => entry.extractFile))) {
    if (!extractFile || extractFile.includes('/') || extractFile.includes('\\') || extractFile.includes('\0')) {
      throw new Error(`Wolf metadata extractFile이 올바르지 않습니다: ${extractFile}`);
    }
    const textPath = path.join(textsRoot, `${extractFile}.txt`);
    if (!fs.existsSync(textPath) || !fs.statSync(textPath).isFile()) {
      throw new Error(`Wolf 추출 텍스트 파일이 없습니다: ${textPath}`);
    }
    result[extractFile] = readTextFile(textPath).split('\n');
  }
  return result;
}

function preflightWolfTexts(
  plan: WolfParallelApplyPlan,
  extractedTexts: Record<string, string[]>,
  ctx: AppContext,
): Map<number, Buffer> {
  const replacements = new Map<number, Buffer>();
  const occupiedLines = new Map<string, Set<number>>();

  for (const planned of plan.entries) {
    const entry = planned.entry;
    const lines = extractedTexts[entry.extractFile];
    const firstLine = entry.textLineNumber[0];
    const separatorLine = firstLine - 1;
    const expectedSeparator = `--- ${entry.codeStr} ---`;
    if (separatorLine < 0 || lines[separatorLine] !== expectedSeparator) {
      throw new Error(`Wolf 추출 텍스트 구분자가 변경되었습니다: ${entry.extractFile}:${separatorLine + 1}`);
    }

    const used = occupiedLines.get(entry.extractFile) ?? new Set<number>();
    for (const lineNumber of [separatorLine, ...entry.textLineNumber]) {
      if (used.has(lineNumber)) {
        throw new Error(`Wolf 추출 텍스트 범위가 겹칩니다: ${entry.extractFile}:${lineNumber + 1}`);
      }
      used.add(lineNumber);
    }
    occupiedLines.set(entry.extractFile, used);

    let originalText = decodeEncoding(entry.str.str, ctx.WolfMetadata);
    if (entry.endsWithNull) {
      if (!originalText.endsWith('\0')) {
        throw new Error(`Wolf metadata의 null 종료 정보가 원본 bytes와 다릅니다: ext.${planned.index}`);
      }
      originalText = originalText.slice(0, -1);
    } else if (originalText.endsWith('\0')) {
      throw new Error(`Wolf metadata가 원본 문자열의 null 종료를 누락했습니다: ext.${planned.index}`);
    }

    const originalLines = originalText.replaceAll('\\', '\\\\').split('\n');
    if (originalLines.length !== entry.textLineNumber.length) {
      throw new Error(`Wolf metadata의 텍스트 줄 수가 원본 bytes와 다릅니다: ext.${planned.index}`);
    }
    const translatedLines = entry.textLineNumber.map((lineNumber) => lines[lineNumber]);
    for (let lineIndex = 0; lineIndex < originalLines.length; lineIndex++) {
      const translatedLine = translatedLines[lineIndex];
      if (translatedLine === undefined) {
        throw new Error(`Wolf 번역 텍스트 줄이 없습니다: ${entry.extractFile}:${entry.textLineNumber[lineIndex] + 1}`);
      }
      if ((originalLines[lineIndex] === '') !== (translatedLine === '')) {
        throw new Error(`Wolf 번역 텍스트의 빈 줄이 변경되었습니다: ${entry.extractFile}:${entry.textLineNumber[lineIndex] + 1}`);
      }
      const originalCodes = extractWolfControlCodes(originalLines[lineIndex]);
      const translatedCodes = extractWolfControlCodes(translatedLine);
      if (!sameStrings(originalCodes, translatedCodes)) {
        throw new Error(`Wolf 번역 텍스트의 제어 코드가 변경되었습니다: ${entry.extractFile}:${entry.textLineNumber[lineIndex] + 1}`);
      }
    }

    let translatedText = translatedLines.join('\n').replaceAll('\\\\', '\\');
    if (entry.endsWithNull) translatedText += '\0';
    replacements.set(planned.index, encodeEncoding(translatedText, ctx.WolfMetadata));
  }

  return replacements;
}

function prepareWolfOutputs(
  plan: WolfParallelApplyPlan,
  normalized: NormalizedWolfSources,
  replacements: Map<number, Buffer>,
): PreparedWolfOutput[] {
  const outputs: PreparedWolfOutput[] = [];

  for (const [sourceFile, sourceEntries] of Object.entries(plan.bySourceFile)) {
    const source = normalized.cache[sourceFile];
    const diskPath = normalized.diskPaths[sourceFile];
    if (!source || !diskPath) {
      throw new Error(`Wolf apply source를 확인할 수 없습니다: ${sourceFile}`);
    }
    const diskBytes = fs.readFileSync(diskPath);
    if (!diskBytes.equals(source)) {
      throw new Error(`Wolf 원본 데이터가 추출 이후 변경되었습니다: ${sourceFile}`);
    }

    const parts: Buffer[] = [];
    let cursor = 0;
    for (const planned of sourceEntries) {
      const replacement = replacements.get(planned.index);
      if (!replacement) {
        throw new Error(`Wolf 번역 bytes가 준비되지 않았습니다: ext.${planned.index}`);
      }
      if (replacement.length > 0xffffffff) {
        throw new Error(`Wolf 번역 문자열이 허용 길이를 초과했습니다: ext.${planned.index}`);
      }
      parts.push(source.subarray(cursor, planned.lengthOffset));
      const lengthHeader = Buffer.allocUnsafe(4);
      lengthHeader.writeUInt32LE(replacement.length, 0);
      parts.push(lengthHeader, replacement);
      cursor = planned.endOffset;
    }
    parts.push(source.subarray(cursor));
    outputs.push({
      sourceFile,
      diskPath,
      original: Buffer.from(source),
      output: Buffer.concat(parts),
      mode: fs.statSync(diskPath).mode,
    });
  }

  return outputs;
}

function commitWolfOutputsTransaction(outputs: PreparedWolfOutput[]): void {
  if (outputs.length === 0) return;
  const transactionId = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const staged = outputs.map((output, index): StagedWolfOutput => {
    const directory = path.dirname(output.diskPath);
    const baseName = path.basename(output.diskPath);
    const prefix = `.${baseName}.wolf-apply-${transactionId}-${index}`;
    return {
      ...output,
      stagedPath: path.join(directory, `${prefix}.staged`),
      backupPath: path.join(directory, `${prefix}.backup`),
      displacedPath: path.join(directory, `${prefix}.displaced`),
    };
  });

  try {
    for (const output of staged) {
      writeStagedBuffer(output.stagedPath, output.output, output.mode);
    }

    // Staging can take time. Recheck every source after all validation and
    // staging work, immediately before the first original is moved.
    for (const output of staged) {
      const current = fs.readFileSync(output.diskPath);
      if (!current.equals(output.original)) {
        throw new Error(`Wolf 원본 데이터가 추출 이후 변경되었습니다: ${output.sourceFile}`);
      }
    }
  } catch (error) {
    cleanupWolfTransactionFiles(staged, ['stagedPath']);
    throw error;
  }

  const committed: StagedWolfOutput[] = [];
  let active: StagedWolfOutput | undefined;
  try {
    for (const output of staged) {
      active = output;
      fs.renameSync(output.diskPath, output.backupPath);
      const movedOriginal = fs.readFileSync(output.backupPath);
      if (!movedOriginal.equals(output.original)) {
        throw new Error(`Wolf 원본 데이터가 commit 직전에 변경되었습니다: ${output.sourceFile}`);
      }
      fs.renameSync(output.stagedPath, output.diskPath);
      committed.push(output);
      active = undefined;
    }
  } catch (error) {
    const rollbackTargets = active && !committed.includes(active)
      ? [...committed, active]
      : committed;
    const rollbackErrors = rollbackWolfOutputs(rollbackTargets);
    cleanupWolfTransactionFiles(staged, ['stagedPath']);
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Wolf 다중 파일 적용에 실패했고 일부 원본 복구도 실패했습니다: ${(error as Error).message}; rollback: ${rollbackErrors.join('; ')}`,
      );
    }
    throw new Error(`Wolf 다중 파일 적용에 실패해 모든 원본을 복구했습니다: ${(error as Error).message}`);
  }

  cleanupWolfTransactionFiles(staged, ['backupPath']);
}

function writeStagedBuffer(filePath: string, content: Buffer, mode: number): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'wx', 0o666);
    fs.writeFileSync(fd, content);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve the original error */ }
    }
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* preserve the original error */ }
    }
    throw new Error(`Wolf 적용 staging 파일을 쓸 수 없습니다: ${filePath} — ${(error as Error).message}`);
  }
}

function rollbackWolfOutputs(outputs: StagedWolfOutput[]): string[] {
  const errors: string[] = [];
  for (const output of [...outputs].reverse()) {
    if (!fs.existsSync(output.backupPath)) continue;
    try {
      if (fs.existsSync(output.diskPath)) {
        fs.renameSync(output.diskPath, output.displacedPath);
      }
      fs.renameSync(output.backupPath, output.diskPath);
      if (fs.existsSync(output.displacedPath)) fs.unlinkSync(output.displacedPath);
    } catch (error) {
      errors.push(`${output.sourceFile}: ${(error as Error).message} (backup=${output.backupPath})`);
    }
  }
  return errors;
}

function cleanupWolfTransactionFiles(
  outputs: StagedWolfOutput[],
  keys: Array<'stagedPath' | 'backupPath'>,
): void {
  for (const output of outputs) {
    for (const key of keys) {
      const filePath = output[key];
      if (!fs.existsSync(filePath)) continue;
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.warn('Wolf apply transaction 임시 파일 정리에 실패했습니다:', filePath, error);
      }
    }
  }
}

function extractWolfControlCodes(line: string): string[] {
  return line.match(WOLF_CONTROL_CODE_REGEX) ?? [];
}

function sameStrings(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}
