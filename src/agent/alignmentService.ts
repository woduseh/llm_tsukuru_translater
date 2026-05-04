import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { AlignmentBreak, AlignmentMap, JsonObject } from '../types/agentWorkspace';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';

export interface AlignmentInspectOptions {
  sourcePath: string;
  targetPath: string;
  metadataPath?: string;
  maxBytes?: number;
  ttlMs?: number;
}

export interface AlignmentInspectResult extends AlignmentMap {
  alignmentRef?: AgentDataRef;
}

export class AlignmentService {
  constructor(
    private readonly options: {
      projectRoot: string;
      files: AgentSafeFileSystem;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
    },
  ) {}

  inspect(input: AlignmentInspectOptions): AlignmentInspectResult {
    assertPath(input.sourcePath, 'alignment.inspect requires a non-empty sourcePath.');
    assertPath(input.targetPath, 'alignment.inspect requires a non-empty targetPath.');
    const source = this.options.files.readText(input.sourcePath, { maxBytes: positiveInt(input.maxBytes, 256 * 1024) });
    const target = this.options.files.readText(input.targetPath, { maxBytes: positiveInt(input.maxBytes, 256 * 1024) });
    const sourceLines = classifyLines(source.text);
    const targetLines = classifyLines(target.text);
    const metadata = input.metadataPath ? readMetadataSummary(this.options.files, this.options.projectRoot, input.metadataPath) : { status: 'not-provided' };
    const breaks = findBreaks(sourceLines, targetLines);
    const score = scoreBreaks(sourceLines.length, targetLines.length, breaks);
    const result: AlignmentInspectResult = {
      schemaVersion: 1,
      alignmentId: `alignment-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sourcePath: source.relativePath,
      targetPath: target.relativePath,
      score,
      confidence: score >= 0.92 ? 'high' : score >= 0.75 ? 'medium' : 'low',
      lineCount: {
        source: sourceLines.length,
        target: targetLines.length,
        delta: targetLines.length - sourceLines.length,
      },
      refs: sourceLines.map((line, index) => {
        const targetLine = targetLines[index];
        const reasons = lineReasons(line, targetLine);
        return {
          sourceLine: line.lineNumber,
          targetLine: targetLine?.lineNumber,
          confidence: targetLine ? Math.max(0, 1 - reasons.length * 0.25) : 0,
          kind: line.kind,
          reasons,
        };
      }),
      breaks,
      metadata,
    };
    const artifact = this.options.artifacts.writeJsonArtifact('alignment-map', result.alignmentId, result as unknown as JsonObject);
    result.alignmentRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'alignment-map',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'alignment.inspect', sourcePath: source.relativePath, targetPath: target.relativePath },
    });
    return result;
  }

  findBreaks(input: AlignmentInspectOptions): JsonObject {
    const inspected = this.inspect(input);
    return {
      schemaVersion: 1,
      sourcePath: inspected.sourcePath,
      targetPath: inspected.targetPath,
      score: inspected.score,
      confidence: inspected.confidence,
      lineCount: inspected.lineCount,
      breaks: inspected.breaks,
      alignmentRef: inspected.alignmentRef,
    } as unknown as JsonObject;
  }

  score(input: AlignmentInspectOptions): JsonObject {
    const inspected = this.inspect(input);
    return {
      schemaVersion: 1,
      score: inspected.score,
      confidence: inspected.confidence,
      breakCount: inspected.breaks.length,
      lineCount: inspected.lineCount,
      alignmentRef: inspected.alignmentRef,
    } as unknown as JsonObject;
  }

  explain(input: AlignmentInspectOptions): JsonObject {
    const inspected = this.inspect(input);
    const topBreaks = inspected.breaks.slice(0, 8);
    return {
      schemaVersion: 1,
      summary: topBreaks.length === 0
        ? 'Source and target keep the first-model alignment invariants.'
        : `${topBreaks.length} representative alignment break(s) found. Preserve line count, separator order, empty-line positions, and RPG control codes before apply.`,
      score: inspected.score,
      confidence: inspected.confidence,
      lineCount: inspected.lineCount,
      topBreaks,
      alignmentRef: inspected.alignmentRef,
    } as unknown as JsonObject;
  }
}

interface ClassifiedLine {
  lineNumber: number;
  text: string;
  kind: 'separator' | 'empty' | 'text';
  separatorId?: string;
  controlCodes: string[];
  speakerLabel?: string;
}

function classifyLines(text: string): ClassifiedLine[] {
  return text.split(/\r?\n/).map((line, index) => {
    const separatorId = parseSeparator(line);
    return {
      lineNumber: index + 1,
      text: line,
      kind: separatorId ? 'separator' : line === '' ? 'empty' : 'text',
      separatorId,
      controlCodes: line.match(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g) ?? [],
      speakerLabel: parseSpeakerLabel(line),
    };
  });
}

function findBreaks(source: ClassifiedLine[], target: ClassifiedLine[]): AlignmentBreak[] {
  const breaks: AlignmentBreak[] = [];
  if (source.length !== target.length) {
    breaks.push({
      code: 'line-count-drift',
      severity: 'error',
      message: `Line count changed from ${source.length} to ${target.length}.`,
    });
  }
  const limit = Math.max(source.length, target.length);
  for (let index = 0; index < limit; index += 1) {
    const left = source[index];
    const right = target[index];
    if (!left || !right) continue;
    if (left.kind === 'separator' || right.kind === 'separator') {
      if (left.separatorId !== right.separatorId) {
        breaks.push({
          code: 'separator-drift',
          severity: 'error',
          sourceLine: left.lineNumber,
          targetLine: right.lineNumber,
          message: `Separator changed at line ${left.lineNumber}: "${left.text}" -> "${right.text}".`,
        });
      }
      continue;
    }
    if (left.kind !== right.kind && (left.kind === 'empty' || right.kind === 'empty')) {
      breaks.push({
        code: 'empty-line-drift',
        severity: 'error',
        sourceLine: left.lineNumber,
        targetLine: right.lineNumber,
        message: `Empty-line alignment changed at line ${left.lineNumber}.`,
      });
    }
    if (left.controlCodes.join('\u0000') !== right.controlCodes.join('\u0000')) {
      breaks.push({
        code: 'control-code-drift',
        severity: 'error',
        sourceLine: left.lineNumber,
        targetLine: right.lineNumber,
        message: `RPG control codes changed at line ${left.lineNumber}.`,
      });
    }
    if (left.speakerLabel && right.speakerLabel && left.speakerLabel !== right.speakerLabel) {
      breaks.push({
        code: 'speaker-label-drift',
        severity: 'warning',
        sourceLine: left.lineNumber,
        targetLine: right.lineNumber,
        message: `Speaker-like label changed at line ${left.lineNumber}: ${left.speakerLabel} -> ${right.speakerLabel}.`,
      });
    }
  }
  return breaks;
}

function lineReasons(source: ClassifiedLine, target?: ClassifiedLine): string[] {
  if (!target) return ['missing-target-line'];
  const reasons: string[] = [];
  if (source.kind !== target.kind) reasons.push('line-kind-drift');
  if (source.separatorId !== target.separatorId) reasons.push('separator-drift');
  if (source.controlCodes.join('\u0000') !== target.controlCodes.join('\u0000')) reasons.push('control-code-drift');
  if (source.speakerLabel && target.speakerLabel && source.speakerLabel !== target.speakerLabel) reasons.push('speaker-label-drift');
  return reasons;
}

function scoreBreaks(sourceLines: number, targetLines: number, breaks: AlignmentBreak[]): number {
  const base = Math.max(sourceLines, targetLines, 1);
  const penalty = breaks.reduce((sum, item) => sum + (item.code === 'line-count-drift' ? 0.35 : item.severity === 'error' ? 1 / base : 0.5 / base), 0);
  return Math.max(0, Math.round((1 - penalty) * 1000) / 1000);
}

function parseSeparator(line: string): string | undefined {
  const match = line.match(/^---\s*([^-]+?)\s*---$/);
  return match?.[1]?.trim();
}

function parseSpeakerLabel(line: string): string | undefined {
  const match = line.match(/^\s*(?:\[([^\]\r\n]{1,32})\]|([^:：\r\n]{1,32})[:：])/);
  return (match?.[1] ?? match?.[2])?.trim();
}

function readMetadataSummary(files: AgentSafeFileSystem, projectRoot: string, metadataPath: string): JsonObject {
  const absolutePath = files.resolveAllowed(metadataPath);
  const relativePath = path.relative(projectRoot, absolutePath);
  const buffer = fs.readFileSync(absolutePath);
  const parsed = parseMetadataBuffer(buffer);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'unrecognized', path: relativePath };
  }
  const root = 'dat' in parsed && parsed.dat && typeof parsed.dat === 'object' ? parsed.dat : parsed;
  const main = 'main' in (root as Record<string, unknown>) ? (root as Record<string, unknown>).main : root;
  const spans = collectMetadataSpans(main);
  return {
    status: 'loaded',
    path: relativePath,
    spanCount: spans.length,
    multilineSpanCount: spans.filter((span) => Number(span.endLine) > Number(span.startLine) + 1).length,
    sampleSpans: spans.slice(0, 12),
  };
}

function parseMetadataBuffer(buffer: Buffer): unknown {
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(zlib.inflateSync(buffer).toString('utf-8')) as unknown;
  }
}

function collectMetadataSpans(value: unknown): JsonObject[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map(([key, entry]) => {
      const obj = entry as Record<string, unknown>;
      return {
        startLine: Number(key),
        endLine: typeof obj.m === 'number' ? obj.m : Number(key) + 1,
        origin: typeof obj.origin === 'string' ? obj.origin : '',
        path: typeof obj.val === 'string' ? obj.val : '',
      };
    })
    .filter((entry) => Number.isFinite(entry.startLine))
    .sort((left, right) => Number(left.startLine) - Number(right.startLine));
}

function assertPath(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
