import * as fs from 'fs';
import * as path from 'path';

export const WOLF_PROJECT_ENGINE = 'wolf-rpg';
export const UNKNOWN_PROJECT_ENGINE = 'unknown';

const WOLF_DATA_EXTENSIONS = new Set(['.wolf', '.mps', '.dat', '.project']);

export function detectAgentProjectEngine(projectRoot: string): string {
  const root = path.resolve(projectRoot);
  const wolfMarkers = [
    path.join(root, 'Data.wolf'),
    path.join(root, 'Data', 'Data.wolf'),
    path.join(root, 'data', 'Data.wolf'),
    path.join(root, '_Extract', 'Texts'),
  ];
  const dataRoot = path.basename(root).toLowerCase() === 'data'
    ? root
    : findChildDirectory(root, 'data');
  return wolfMarkers.some((candidate) => fs.existsSync(candidate))
    || Boolean(dataRoot && containsWolfDataFile(dataRoot))
    ? WOLF_PROJECT_ENGINE
    : UNKNOWN_PROJECT_ENGINE;
}

export function isWolfDataPath(filePath: string): boolean {
  return WOLF_DATA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function findChildDirectory(root: string, name: string): string | undefined {
  try {
    const target = name.toLowerCase();
    const entry = fs.readdirSync(root, { withFileTypes: true })
      .find((candidate) => !candidate.isSymbolicLink()
        && candidate.isDirectory()
        && candidate.name.toLowerCase() === target);
    return entry ? path.join(root, entry.name) : undefined;
  } catch {
    return undefined;
  }
}

function containsWolfDataFile(root: string, maxEntries = 500): boolean {
  let visited = 0;
  const pending = [root];
  while (pending.length > 0 && visited < maxEntries) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited++ >= maxEntries) return false;
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && isWolfDataPath(candidate)) return true;
      if (entry.isDirectory()) pending.push(candidate);
    }
  }
  return false;
}
