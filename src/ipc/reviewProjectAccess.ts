import fs from 'fs';
import path from 'path';
import { AppContext } from '../appContext';
import { resolveReviewTextTarget } from '../ts/rpgmv/reviewTextWrite';
import { normalizeDirectoryLockKey } from '../ts/libs/concurrency';

/** Review navigation uses an existing folder grant; it cannot create one. */
export function resolveGrantedReviewProject(ctx: AppContext, input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || !path.isAbsolute(input)) {
    throw new Error('검수 프로젝트 경로가 올바르지 않습니다.');
  }
  const root = fs.realpathSync(input);
  if (!fs.statSync(root).isDirectory()) throw new Error('검수 프로젝트는 폴더여야 합니다.');
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const granted = ctx.allowedProjectRoots.some(candidate => {
    try { return normalize(fs.realpathSync(candidate)) === normalize(root); }
    catch { return false; }
  });
  if (!granted) throw new Error('먼저 검수할 프로젝트 폴더를 선택해 주세요.');
  return root;
}

export function resolveReviewRetranslationTarget(ctx: AppContext, projectDir: unknown, fileName: string, activeProjectDir: string): string {
  const root = resolveGrantedReviewProject(ctx, projectDir);
  if (normalizeDirectoryLockKey(root) !== normalizeDirectoryLockKey(activeProjectDir)) {
    throw new Error('재번역 대상이 현재 검수 프로젝트와 다릅니다.');
  }
  const wolfExtract = path.join(root, '_Extract', 'Texts');
  const extractDir = fs.existsSync(wolfExtract) && fs.existsSync(`${wolfExtract}_backup`)
    ? wolfExtract : path.join(root, 'Extract');
  resolveReviewTextTarget(root, path.join(extractDir, fileName), fileName);
  const backupDir = fs.realpathSync(`${extractDir}_backup`);
  const relative = path.relative(root, backupDir);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('재번역 원본이 승인된 프로젝트 밖에 있습니다.');
  }
  const backup = fs.lstatSync(path.join(backupDir, fileName));
  if (!backup.isFile() || backup.isSymbolicLink()) throw new Error('재번역 원본이 일반 파일이 아닙니다.');
  return extractDir;
}
