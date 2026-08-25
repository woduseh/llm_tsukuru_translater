import fs from 'fs';
import path from 'path';
import { atomicWriteTextFile } from '../libs/atomicFile';

export interface VerifiedJsonWriteRequest {
  fileName: string;
  targetPath: string;
  expectedContent: string;
  nextContent: string;
}

export function applyVerifiedJsonWrite(
  verifyDataDir: string,
  request: VerifiedJsonWriteRequest,
): void {
  const targetPath = resolveVerifyJsonTarget(verifyDataDir, request.targetPath, request.fileName);
  JSON.parse(stripBom(request.nextContent));
  atomicWriteTextFile(targetPath, request.nextContent, {
    encoding: 'utf-8',
    expectedContent: request.expectedContent,
  });
}

export function resolveVerifyJsonTarget(
  verifyDataDir: string,
  requestedPath: string,
  fileName: string,
): string {
  if (typeof fileName !== 'string'
    || path.basename(fileName) !== fileName
    || path.extname(fileName).toLowerCase() !== '.json') {
    throw new Error('JSON Verify 파일 이름이 올바르지 않습니다.');
  }

  const dataDir = path.resolve(verifyDataDir);
  const targetPath = path.resolve(requestedPath);
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    throw new Error('JSON Verify data 폴더가 존재하지 않습니다.');
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error('JSON Verify 대상 파일이 존재하지 않습니다.');
  }
  const targetStat = fs.lstatSync(targetPath);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
    throw new Error('JSON Verify 대상이 일반 파일이 아닙니다.');
  }
  if (path.basename(targetPath) !== fileName) {
    throw new Error('JSON Verify 대상 파일 신원이 일치하지 않습니다.');
  }

  const allowedRoots = [dataDir, path.join(dataDir, 'Completed', 'data')]
    .filter((root) => fs.existsSync(root) && fs.statSync(root).isDirectory())
    .map((root) => fs.realpathSync(root));
  const targetParent = fs.realpathSync(path.dirname(targetPath));
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!allowedRoots.some((root) => normalize(root) === normalize(targetParent))) {
    throw new Error('JSON Verify 대상이 허용된 번역 경로 밖에 있습니다.');
  }
  return targetPath;
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}
