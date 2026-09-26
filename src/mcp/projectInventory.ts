import * as fs from 'fs';
import * as path from 'path';
import type { JsonObject } from '../types/agentWorkspace';
import { detectAgentProjectEngine, isWolfDataPath, WOLF_PROJECT_ENGINE } from '../agent/projectEngine';

export function buildTranslationInventory(projectRoot: string, maxFiles: number): JsonObject {
  const projectEngine = detectAgentProjectEngine(projectRoot);
  const inventory = {
    projectRoot,
    projectEngine,
    wolfDetected: projectEngine === WOLF_PROJECT_ENGINE,
    scannedFiles: 0,
    dataJsonFiles: [] as JsonObject[],
    wolfDataFiles: [] as JsonObject[],
    extractedTextFiles: [] as JsonObject[],
    extractedMetadataFiles: [] as JsonObject[],
    warnings: [] as string[],
  };
  for (const filePath of walkFiles(projectRoot, maxFiles, inventory.warnings)) {
    const rel = path.relative(projectRoot, filePath);
    const stat = fs.statSync(filePath);
    const lower = path.basename(filePath).toLowerCase();
    if (isWolfDataPath(filePath)) {
      inventory.wolfDataFiles.push({ path: rel, sizeBytes: stat.size });
    } else if (
      lower.endsWith('.json') &&
      (path.dirname(rel).toLowerCase().endsWith('data') || /^map\d{3}\.json$/i.test(lower))
    ) {
      inventory.dataJsonFiles.push({ path: rel, sizeBytes: stat.size });
    } else if (lower.endsWith('.txt')) {
      inventory.extractedTextFiles.push({
        path: rel,
        sizeBytes: stat.size,
        lineCount: countLinesBounded(filePath, 256 * 1024),
      });
    } else if (lower.endsWith('.extracteddata')) {
      inventory.extractedMetadataFiles.push({ path: rel, sizeBytes: stat.size });
    }
    inventory.scannedFiles += 1;
  }
  return inventory;
}

function walkFiles(root: string, maxFiles: number, warnings: string[]): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const queue = [root];
  while (queue.length && result.length < maxFiles) {
    const current = queue.shift() as string;
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      if (entry.isFile()) result.push(fullPath);
      if (result.length >= maxFiles) {
        warnings.push(`Stopped scan at maxFiles ${maxFiles}.`);
        break;
      }
    }
  }
  return result;
}

function countLinesBounded(filePath: string, maxBytes: number): number {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(fs.statSync(filePath).size, maxBytes));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf-8').split(/\r?\n/).length;
  } finally {
    fs.closeSync(fd);
  }
}
