import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  coerceLlmProjectArg,
  rememberAllowedProjectRoot,
  validateLlmProjectPath,
} from '../../src/ipc/llmProjectPathValidation';

const tmpRoot = path.join(process.cwd(), 'test', '.tmp-llm-project-paths');

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('llmProjectPathValidation', () => {
  it('accepts a selected RPG Maker data folder and canonicalizes the path', () => {
    const dataDir = makeMvMzProject('selected-mvmz');
    const allowedRoots = rememberAllowedProjectRoot([], dataDir);

    const result = validateLlmProjectPath({ dir: dataDir.replaceAll('\\', '/'), game: 'mvmz' }, { allowedRoots });

    expect(result.game).toBe('mvmz');
    expect(result.dir).toBe(fs.realpathSync.native(dataDir));
    expect(result.extractDir).toBe(path.join(result.dir, 'Extract'));
  });

  it('keeps compatibility with base64-encoded project paths', () => {
    const dataDir = makeMvMzProject('base64-mvmz');
    const allowedRoots = rememberAllowedProjectRoot([], dataDir);
    const encoded = Buffer.from(dataDir, 'utf8').toString('base64');

    const result = validateLlmProjectPath({ dir: encoded, game: 'mvmz' }, { allowedRoots });

    expect(result.dir).toBe(fs.realpathSync.native(dataDir));
  });

  it('accepts Wolf RPG Editor folders with extracted text evidence', () => {
    const wolfDir = path.join(tmpRoot, 'wolf-game');
    fs.mkdirSync(path.join(wolfDir, '_Extract', 'Texts'), { recursive: true });
    const allowedRoots = rememberAllowedProjectRoot([], wolfDir);

    const result = validateLlmProjectPath({ dir: wolfDir, game: 'wolf' }, { allowedRoots });

    expect(result.extractDir).toBe(path.join(result.dir, '_Extract', 'Texts'));
  });

  it('fails closed when no trusted project root has been selected', () => {
    const dataDir = makeMvMzProject('no-allowlist');

    expect(() => validateLlmProjectPath({ dir: dataDir, game: 'mvmz' }))
      .toThrow('먼저 프로젝트 폴더를 선택');
  });

  it('rejects unselected valid-looking project paths when an allowlist exists', () => {
    const selected = makeMvMzProject('selected');
    const outside = makeMvMzProject('outside');
    const allowedRoots = rememberAllowedProjectRoot([], selected);

    expect(() => validateLlmProjectPath({ dir: outside, game: 'mvmz' }, { allowedRoots }))
      .toThrow('선택한 프로젝트 폴더 밖의 경로');
  });

  it('rejects missing, relative, malformed, and non-project paths before scanning', () => {
    const ordinaryDir = path.join(tmpRoot, 'ordinary');
    fs.mkdirSync(ordinaryDir, { recursive: true });

    expect(() => coerceLlmProjectArg({ dir: ordinaryDir, game: 'unknown' })).toThrow('지원하지 않는 게임 형식');
    expect(() => validateLlmProjectPath({ dir: 'relative\\data', game: 'mvmz' })).toThrow('절대 경로');
    expect(() => validateLlmProjectPath({ dir: path.join(tmpRoot, 'missing'), game: 'mvmz' })).toThrow('존재하지 않습니다');
    expect(() => validateLlmProjectPath(
      { dir: ordinaryDir, game: 'mvmz' },
      { allowedRoots: rememberAllowedProjectRoot([], ordinaryDir) },
    )).toThrow('data 폴더');
  });

  it('rejects base64-encoded paths that decode outside the selected project', () => {
    const selected = makeMvMzProject('selected-base64');
    const outside = makeMvMzProject('outside-base64');
    const allowedRoots = rememberAllowedProjectRoot([], selected);
    const encodedOutside = Buffer.from(outside, 'utf8').toString('base64');

    expect(() => validateLlmProjectPath({ dir: encodedOutside, game: 'mvmz' }, { allowedRoots }))
      .toThrow('선택한 프로젝트 폴더 밖의 경로');
  });

  it('rejects UNC and alternate data stream paths', () => {
    const dataDir = makeMvMzProject('unsafe-path-shapes');
    const allowedRoots = rememberAllowedProjectRoot([], dataDir);

    expect(() => validateLlmProjectPath({ dir: '\\\\server\\share\\game\\data', game: 'mvmz' }))
      .toThrow('UNC');
    expect(() => validateLlmProjectPath({ dir: `${dataDir}:Zone.Identifier`, game: 'mvmz' }, { allowedRoots }))
      .toThrow('대체 데이터 스트림');
  });
});

function makeMvMzProject(name: string): string {
  const dataDir = path.join(tmpRoot, name, 'data');
  fs.mkdirSync(path.join(dataDir, 'Extract'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'System.json'), '{}', 'utf8');
  return dataDir;
}
