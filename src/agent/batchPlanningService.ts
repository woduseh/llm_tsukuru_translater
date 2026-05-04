import * as fs from 'fs';
import * as path from 'path';
import type { JsonObject } from '../types/agentWorkspace';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';

export interface BatchPlanOptions {
  scope?: {
    paths?: string[];
    includePattern?: string;
  };
  filter?: {
    minLines?: number;
    untranslatedOnly?: boolean;
  };
  limits?: {
    maxFiles?: number;
    maxTotalLines?: number;
    maxLinesPerBatch?: number;
    maxBatches?: number;
  };
  dryRun?: boolean;
  ttlMs?: number;
}

export interface BatchPlanResult {
  schemaVersion: 1;
  dryRun: true;
  createdAt: string;
  inventory: {
    consideredFiles: number;
    plannedFiles: number;
    plannedLines: number;
    skippedFiles: JsonObject[];
  };
  limits: Required<NonNullable<BatchPlanOptions['limits']>>;
  batches: JsonObject[];
  manifestRef?: AgentDataRef;
}

interface InventoryItem {
  path: string;
  lineCount: number;
  nonEmptyLineCount: number;
  estimatedChars: number;
  untranslatedScore: number;
}

export class BatchPlanningService {
  constructor(
    private readonly options: {
      projectRoot: string;
      files: AgentSafeFileSystem;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
    },
  ) {}

  estimate(input: BatchPlanOptions = {}): JsonObject {
    const limits = normalizeLimits(input.limits);
    const inventory = this.collectInventory(input, limits.maxFiles);
    return {
      dryRun: true,
      consideredFiles: inventory.items.length + inventory.skipped.length,
      eligibleFiles: inventory.items.length,
      estimatedLines: inventory.items.reduce((sum, item) => sum + item.lineCount, 0),
      estimatedChars: inventory.items.reduce((sum, item) => sum + item.estimatedChars, 0),
      skippedFiles: inventory.skipped,
      limits,
    };
  }

  plan(input: BatchPlanOptions = {}): BatchPlanResult {
    if (input.dryRun === false) throw new Error('batch.plan only supports dryRun=true in the scaffold.');
    const limits = normalizeLimits(input.limits);
    const inventory = this.collectInventory(input, limits.maxFiles);
    const batches: JsonObject[] = [];
    const skipped = [...inventory.skipped];
    let current: InventoryItem[] = [];
    let currentLines = 0;
    let plannedLines = 0;

    for (const item of inventory.items) {
      if (plannedLines + item.lineCount > limits.maxTotalLines) {
        skipped.push({ path: item.path, reason: 'maxTotalLines' });
        continue;
      }
      if (current.length > 0 && currentLines + item.lineCount > limits.maxLinesPerBatch) {
        batches.push(toBatch(batches.length + 1, current));
        current = [];
        currentLines = 0;
      }
      if (batches.length >= limits.maxBatches) {
        skipped.push({ path: item.path, reason: 'maxBatches' });
        continue;
      }
      current.push(item);
      currentLines += item.lineCount;
      plannedLines += item.lineCount;
    }
    if (current.length > 0 && batches.length < limits.maxBatches) {
      batches.push(toBatch(batches.length + 1, current));
    }

    const result: BatchPlanResult = {
      schemaVersion: 1,
      dryRun: true,
      createdAt: new Date().toISOString(),
      inventory: {
        consideredFiles: inventory.items.length + skipped.length,
        plannedFiles: batches.reduce((sum, batch) => sum + Number(batch.fileCount), 0),
        plannedLines,
        skippedFiles: skipped,
      },
      limits,
      batches,
    };
    const artifact = this.options.artifacts.writeJsonArtifact('batch-manifest', `batch-plan-${Date.now()}`, result as unknown as JsonObject);
    result.manifestRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'batch-manifest',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'batch.plan', dryRun: true },
    });
    return result;
  }

  private collectInventory(input: BatchPlanOptions, maxFiles: number): { items: InventoryItem[]; skipped: JsonObject[] } {
    const skipped: JsonObject[] = [];
    const scoped = new Set((input.scope?.paths ?? []).map((entry) => path.normalize(entry).toLowerCase()));
    const include = input.scope?.includePattern ? new RegExp(input.scope.includePattern) : undefined;
    const items = listTextFiles(this.options.projectRoot, maxFiles, skipped)
      .filter((relativePath) => scoped.size === 0 || scoped.has(path.normalize(relativePath).toLowerCase()))
      .filter((relativePath) => !include || include.test(relativePath))
      .map((relativePath) => readInventoryItem(this.options.files, relativePath))
      .filter((item) => {
        if (item.lineCount < (input.filter?.minLines ?? 0)) return false;
        if (input.filter?.untranslatedOnly && item.untranslatedScore <= 0) return false;
        return true;
      });
    return { items, skipped };
  }
}

function toBatch(index: number, items: InventoryItem[]): JsonObject {
  return {
    batchId: `batch-${String(index).padStart(3, '0')}`,
    fileCount: items.length,
    lineCount: items.reduce((sum, item) => sum + item.lineCount, 0),
    estimatedChars: items.reduce((sum, item) => sum + item.estimatedChars, 0),
    files: items.map((item) => ({
      path: item.path,
      lineCount: item.lineCount,
      nonEmptyLineCount: item.nonEmptyLineCount,
      untranslatedScore: item.untranslatedScore,
    })),
  };
}

function readInventoryItem(files: AgentSafeFileSystem, relativePath: string): InventoryItem {
  const read = files.readText(relativePath, { maxBytes: 256 * 1024 });
  const lines = read.text.split(/\r?\n/);
  return {
    path: read.relativePath,
    lineCount: lines.length,
    nonEmptyLineCount: lines.filter((line) => line.trim() !== '').length,
    estimatedChars: read.text.length,
    untranslatedScore: lines.filter(isLikelyUntranslated).length,
  };
}

function listTextFiles(projectRoot: string, maxFiles: number, skipped: JsonObject[]): string[] {
  const result: string[] = [];
  const queue = [projectRoot];
  while (queue.length && result.length < maxFiles) {
    const current = queue.shift() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.llm-tsukuru-agent') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) result.push(path.relative(projectRoot, fullPath));
      if (result.length >= maxFiles) {
        skipped.push({ reason: 'maxFiles', maxFiles });
        break;
      }
    }
  }
  return result;
}

function normalizeLimits(limits: BatchPlanOptions['limits'] = {}): Required<NonNullable<BatchPlanOptions['limits']>> {
  return {
    maxFiles: positiveInt(limits.maxFiles, 100),
    maxTotalLines: positiveInt(limits.maxTotalLines, 2_000),
    maxLinesPerBatch: positiveInt(limits.maxLinesPerBatch, 200),
    maxBatches: positiveInt(limits.maxBatches, 20),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isLikelyUntranslated(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !/^---\s*[^-]+---$/.test(trimmed) && !/[가-힣]/.test(trimmed);
}
