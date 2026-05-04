import * as fs from 'fs';
import * as path from 'path';
import type { JsonObject } from '../types/agentWorkspace';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';
import { redactSecretLikeValues } from './contractsValidation';

export type CorpusSampleStrategy = 'deterministic' | 'random' | 'longest-lines' | 'control-code-heavy' | 'untranslated-heavy' | 'previous-failure-hotspots';

export interface CorpusSampleOptions {
  strategy?: CorpusSampleStrategy;
  seed?: number;
  maxSamples?: number;
  maxLineChars?: number;
  maxFiles?: number;
  paths?: string[];
  ttlMs?: number;
}

export interface CorpusSampleResult {
  schemaVersion: 1;
  strategy: CorpusSampleStrategy;
  bounded: true;
  createdAt: string;
  sampleCount: number;
  maxLineChars: number;
  samples: JsonObject[];
  sampleRef?: AgentDataRef;
  warnings: string[];
}

interface CandidateLine {
  path: string;
  lineNumber: number;
  text: string;
  length: number;
  controlCodeCount: number;
  untranslatedScore: number;
  failureScore: number;
}

export class CorpusSamplingService {
  constructor(
    private readonly options: {
      projectRoot: string;
      workspaceRoot: string;
      files: AgentSafeFileSystem;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
    },
  ) {}

  sample(input: CorpusSampleOptions = {}): CorpusSampleResult {
    const strategy = input.strategy ?? 'deterministic';
    const maxSamples = positiveInt(input.maxSamples, 12);
    const maxLineChars = Math.min(positiveInt(input.maxLineChars, 160), 500);
    const warnings: string[] = [];
    const candidates = this.collectCandidates(input, warnings);
    const selected = chooseCandidates(candidates, strategy, maxSamples, input.seed ?? 1);
    const samples = selected.map((candidate) => {
      const clipped = candidate.text.length > maxLineChars ? `${candidate.text.slice(0, maxLineChars)}…` : candidate.text;
      const redacted = redactSecretLikeValues({ text: clipped });
      return {
        path: candidate.path,
        lineNumber: candidate.lineNumber,
        text: redacted.value.text,
        length: candidate.length,
        controlCodeCount: candidate.controlCodeCount,
        untranslatedScore: candidate.untranslatedScore,
        failureScore: candidate.failureScore,
        redactions: redacted.redactions,
      };
    });
    if (strategy === 'previous-failure-hotspots' && selected.every((candidate) => candidate.failureScore === 0)) {
      warnings.push('No previous failure hotspots found; returned deterministic fallback samples.');
    }
    const result: CorpusSampleResult = {
      schemaVersion: 1,
      strategy,
      bounded: true,
      createdAt: new Date().toISOString(),
      sampleCount: samples.length,
      maxLineChars,
      samples,
      warnings,
    };
    const artifact = this.options.artifacts.writeJsonArtifact('corpus-sample', `corpus-sample-${Date.now()}`, result as unknown as JsonObject);
    result.sampleRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'corpus-sample',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'corpus.sample', strategy },
    });
    return result;
  }

  private collectCandidates(input: CorpusSampleOptions, warnings: string[]): CandidateLine[] {
    const paths = input.paths?.length ? input.paths : listTextFiles(this.options.projectRoot, positiveInt(input.maxFiles, 100), warnings);
    const hotspots = readFailureHotspots(this.options.workspaceRoot);
    const candidates: CandidateLine[] = [];
    for (const relativePath of paths) {
      const read = this.options.files.readText(relativePath, { maxBytes: 256 * 1024 });
      read.text.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || /^---\s*[^-]+---$/.test(trimmed)) return;
        const controlCodeCount = (line.match(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g) ?? []).length;
        candidates.push({
          path: read.relativePath,
          lineNumber: index + 1,
          text: line,
          length: line.length,
          controlCodeCount,
          untranslatedScore: isLikelyUntranslated(line) ? 1 : 0,
          failureScore: hotspots.has(path.normalize(read.relativePath).toLowerCase()) ? 1 : 0,
        });
      });
    }
    return candidates;
  }
}

function chooseCandidates(candidates: CandidateLine[], strategy: CorpusSampleStrategy, maxSamples: number, seed: number): CandidateLine[] {
  const stable = [...candidates].sort((a, b) => a.path.localeCompare(b.path, 'en') || a.lineNumber - b.lineNumber);
  if (strategy === 'random') return shuffle(stable, seed).slice(0, maxSamples);
  if (strategy === 'longest-lines') return stable.sort((a, b) => b.length - a.length || a.path.localeCompare(b.path, 'en') || a.lineNumber - b.lineNumber).slice(0, maxSamples);
  if (strategy === 'control-code-heavy') return stable.sort((a, b) => b.controlCodeCount - a.controlCodeCount || b.length - a.length).slice(0, maxSamples);
  if (strategy === 'untranslated-heavy') return stable.sort((a, b) => b.untranslatedScore - a.untranslatedScore || b.length - a.length).slice(0, maxSamples);
  if (strategy === 'previous-failure-hotspots') return stable.sort((a, b) => b.failureScore - a.failureScore || a.path.localeCompare(b.path, 'en') || a.lineNumber - b.lineNumber).slice(0, maxSamples);
  return stable.slice(0, maxSamples);
}

function shuffle(items: CandidateLine[], seed: number): CandidateLine[] {
  const result = [...items];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function listTextFiles(projectRoot: string, maxFiles: number, warnings: string[]): string[] {
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
        warnings.push(`Stopped corpus scan at maxFiles ${maxFiles}.`);
        break;
      }
    }
  }
  return result;
}

function readFailureHotspots(workspaceRoot: string): Set<string> {
  const hotspots = new Set<string>();
  const jobsRoot = path.join(workspaceRoot, 'jobs');
  if (!fs.existsSync(jobsRoot)) return hotspots;
  for (const entry of fs.readdirSync(jobsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const text = fs.readFileSync(path.join(jobsRoot, entry.name), 'utf-8');
    const matches = text.match(/[A-Za-z0-9_. -]+\.txt/g) ?? [];
    for (const match of matches) hotspots.add(path.normalize(match.trim()).toLowerCase());
  }
  return hotspots;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isLikelyUntranslated(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !/[가-힣]/.test(trimmed);
}
