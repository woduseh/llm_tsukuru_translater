import fs from 'fs';
import path from 'path';
import { atomicWriteTextFile } from '../libs/atomicFile';
import { isTranslationTextFileName } from '../libs/translationSyntax';

export interface ReviewedTextWriteRequest {
  projectDir: string;
  fileName: string;
  targetPath: string;
  expectedContent: string;
  nextContent: string;
}

export interface ReviewedTextWriteResult {
  success: boolean;
  error?: string;
}

/** Manual review may repair line counts; only its storage precondition is shared with agent writes. */
export function applyReviewedTextWrite(projectDir: string, request: ReviewedTextWriteRequest): void {
  const target = resolveReviewTextTarget(projectDir, request.targetPath, request.fileName);
  atomicWriteTextFile(target, request.nextContent, {
    encoding: 'utf8', expectedContent: request.expectedContent, mode: fs.statSync(target).mode,
  });
}

export function resolveReviewTextTarget(projectDir: string, requestedPath: string, fileName: string): string {
  if (typeof fileName !== 'string' || /[\\/]/.test(fileName) || !isTranslationTextFileName(fileName)) {
    throw new Error('텍스트 검수 파일 이름이 올바르지 않습니다.');
  }
  const root = fs.realpathSync(projectDir);
  const target = path.resolve(requestedPath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || path.basename(target) !== fileName) {
    throw new Error('텍스트 검수 대상 파일이 올바르지 않습니다.');
  }
  const parent = fs.realpathSync(path.dirname(target));
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const normalizedRoot = normalize(root);
  const allowedParents = [path.join(root, 'Extract'), path.join(root, '_Extract', 'Texts')]
    .filter(dir => fs.existsSync(dir) && fs.statSync(dir).isDirectory())
    .map(dir => normalize(fs.realpathSync(dir)))
    .filter(dir => dir.startsWith(normalizedRoot + path.sep));
  if (!allowedParents.includes(normalize(parent))) {
    throw new Error('텍스트 검수 대상이 허용된 번역 경로 밖에 있습니다.');
  }
  return target;
}
