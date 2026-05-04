import type { JsonObject } from '../types/agentWorkspace';
import type { AgentSafeFileSystem } from './agentSafeFileSystem';
import type { AlignmentInspectOptions, AlignmentInspectResult, AlignmentService } from './alignmentService';
import type { ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import type { DataRefService } from './dataRefService';
import type { GlossaryEntry, GlossaryService } from './glossaryService';
import type { MemoryService } from './memoryService';

export type QaDimension =
  | 'lineAlignment'
  | 'separatorPreservation'
  | 'controlCodePreservation'
  | 'placeholderPreservation'
  | 'untranslatedText'
  | 'glossaryConsistency'
  | 'speakerConsistency'
  | 'styleAdherence'
  | 'fluency'
  | 'lengthAnomaly'
  | 'jsonApplyRisk';

export interface QaScoreFileOptions extends Partial<AlignmentInspectOptions> {
  path?: string;
  targetPath?: string;
  sourcePath?: string;
  metadataPath?: string;
  maxBytes?: number;
  ttlMs?: number;
}

export interface QaBatchScoreOptions {
  files: QaScoreFileOptions[];
  threshold?: number;
  maxFiles?: number;
}

export interface QaThresholdGateOptions extends QaScoreFileOptions {
  score?: QaScoreResult;
  threshold?: number;
  blockOnErrors?: boolean;
  includeApplyPreviewScaffold?: boolean;
}

export interface QaExplainScoreOptions extends QaScoreFileOptions {
  score?: QaScoreResult;
  scoreRefId?: string;
}

export interface QaCompareVersionsOptions {
  sourcePath: string;
  versions: Array<{ label: string; targetPath: string; metadataPath?: string }>;
  threshold?: number;
}

export interface QaFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  dimension: QaDimension;
  message: string;
  lineNumber?: number;
  details?: JsonObject;
}

export interface QaDimensionScore {
  key: QaDimension;
  label: string;
  weight: number;
  score: number;
  findingCount: number;
  status: 'pass' | 'warn' | 'fail';
}

export interface QaScoreResult {
  schemaVersion: 1;
  qaScoreId: string;
  createdAt: string;
  sourcePath?: string;
  targetPath: string;
  metadataPath?: string;
  qualityScore: number;
  confidence: 'high' | 'medium' | 'low';
  dimensions: QaDimensionScore[];
  findings: QaFinding[];
  alignment?: JsonObject;
  glossary: JsonObject;
  memory: JsonObject;
  qaRef?: AgentDataRef;
  nextSuggestedCalls: string[];
}

const DIMENSIONS: Array<{ key: QaDimension; label: string; weight: number }> = [
  { key: 'lineAlignment', label: 'Line alignment', weight: 20 },
  { key: 'separatorPreservation', label: 'Separator preservation', weight: 12 },
  { key: 'controlCodePreservation', label: 'Control-code preservation', weight: 12 },
  { key: 'placeholderPreservation', label: 'Placeholder preservation', weight: 10 },
  { key: 'untranslatedText', label: 'Untranslated text', weight: 8 },
  { key: 'glossaryConsistency', label: 'Glossary consistency', weight: 10 },
  { key: 'speakerConsistency', label: 'Speaker consistency', weight: 6 },
  { key: 'styleAdherence', label: 'Style adherence', weight: 5 },
  { key: 'fluency', label: 'Fluency', weight: 5 },
  { key: 'lengthAnomaly', label: 'Length anomaly', weight: 7 },
  { key: 'jsonApplyRisk', label: 'JSON/apply risk', weight: 5 },
];

export class QaService {
  constructor(
    private readonly options: {
      files: AgentSafeFileSystem;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
      alignment: AlignmentService;
      glossary: GlossaryService;
      memory: MemoryService;
    },
  ) {}

  scoreFile(input: QaScoreFileOptions): QaScoreResult {
    const targetPath = assertTargetPath(input);
    const target = this.options.files.readText(targetPath, { maxBytes: positiveInt(input.maxBytes, 256 * 1024) });
    const source = input.sourcePath
      ? this.options.files.readText(input.sourcePath, { maxBytes: positiveInt(input.maxBytes, 256 * 1024) })
      : undefined;
    const targetLines = splitLines(target.text);
    const sourceLines = source ? splitLines(source.text) : undefined;
    const alignment = source
      ? this.options.alignment.inspect({
        sourcePath: source.relativePath,
        targetPath: target.relativePath,
        metadataPath: input.metadataPath,
        maxBytes: input.maxBytes,
        ttlMs: input.ttlMs,
      })
      : undefined;
    const findings: QaFinding[] = [];

    if (!target.relativePath.toLowerCase().endsWith('.txt')) {
      findings.push(finding('warning', 'non-text-extension', 'jsonApplyRisk', 'QA scoring is optimized for extracted .txt files.'));
    }
    if (target.truncated || source?.truncated) {
      findings.push(finding('warning', 'truncated-read', 'jsonApplyRisk', 'One or more files were read only up to the QA maxBytes limit.'));
    }

    findings.push(...alignmentFindings(alignment));
    findings.push(...compareLineInvariants(sourceLines, targetLines));
    findings.push(...untranslatedFindings(sourceLines, targetLines));
    findings.push(...glossaryFindings(this.options.glossary.search({ limit: 500 }), sourceLines, targetLines, target.text));
    findings.push(...styleFindings(this.options.memory, targetLines));
    findings.push(...fluencyFindings(targetLines));
    findings.push(...lengthFindings(sourceLines, targetLines));
    findings.push(...metadataRiskFindings(alignment, targetLines.length));

    const dimensions = scoreDimensions(findings, alignment);
    const qualityScore = round3(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / DIMENSIONS.reduce((sum, item) => sum + item.weight, 0));
    const result: QaScoreResult = {
      schemaVersion: 1,
      qaScoreId: `qa-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sourcePath: source?.relativePath,
      targetPath: target.relativePath,
      metadataPath: input.metadataPath,
      qualityScore,
      confidence: source ? qualityConfidence(qualityScore) : 'medium',
      dimensions,
      findings,
      alignment: alignmentSummary(alignment),
      glossary: {
        checkedEntries: this.options.glossary.search({ limit: 500 }).length,
        findingCount: findings.filter((item) => item.dimension === 'glossaryConsistency').length,
      },
      memory: this.options.memory.summarize({ limit: 20 }),
      nextSuggestedCalls: nextCallsForScore(qualityScore, findings),
    };
    const artifact = this.options.artifacts.writeJsonArtifact('qa-score', result.qaScoreId, result as unknown as JsonObject);
    result.qaRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'qa-score',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'qa.score_file', targetPath: result.targetPath },
    });
    return result;
  }

  scoreBatch(input: QaBatchScoreOptions): JsonObject {
    const files = (input.files ?? []).slice(0, positiveInt(input.maxFiles, 50));
    const scores = files.map((file) => this.scoreFile(file));
    const averageScore = scores.length ? round3(scores.reduce((sum, score) => sum + score.qualityScore, 0) / scores.length) : 0;
    const threshold = normalizeThreshold(input.threshold);
    return {
      schemaVersion: 1,
      qualityScore: averageScore,
      threshold,
      passed: scores.every((score) => score.qualityScore >= threshold && !score.findings.some((finding) => finding.severity === 'error')),
      fileCount: scores.length,
      scores: scores.map((score) => scoreSummary(score)) as unknown as JsonObject[],
      nextSuggestedCalls: averageScore >= threshold ? ['qa.threshold_gate'] : ['qa.explain_score', 'patch.propose', 'qa.score_file'],
    };
  }

  explainScore(input: QaExplainScoreOptions): JsonObject {
    const score = input.score ?? this.readScoreRef(input.scoreRefId) ?? this.scoreFile(input);
    const topFindings = [...score.findings].sort(severitySort).slice(0, 12);
    return {
      schemaVersion: 1,
      qualityScore: score.qualityScore,
      confidence: score.confidence,
      summary: topFindings.length === 0
        ? 'QA score is high and no deterministic gate findings were detected.'
        : `${topFindings.length} representative QA finding(s) need review before apply.`,
      dimensions: score.dimensions as unknown as JsonObject[],
      topFindings: topFindings as unknown as JsonObject[],
      nextSuggestedCalls: score.nextSuggestedCalls,
    };
  }

  readScoreRefPayload(refId: string): JsonObject {
    const score = this.readScoreRef(refId);
    if (!score) throw new Error(`Unknown QA score ref: ${refId}`);
    return score as unknown as JsonObject;
  }

  suggestNextCalls(input: QaExplainScoreOptions): JsonObject {
    const score = input.score ?? this.readScoreRef(input.scoreRefId) ?? this.scoreFile(input);
    return {
      schemaVersion: 1,
      qualityScore: score.qualityScore,
      nextSuggestedCalls: score.nextSuggestedCalls,
      topFindingCodes: score.findings.slice(0, 8).map((finding) => finding.code),
    };
  }

  thresholdGate(input: QaThresholdGateOptions): JsonObject {
    const score = input.score ?? this.scoreFile(input);
    const threshold = normalizeThreshold(input.threshold);
    const blockingFindings = score.findings.filter((item) => item.severity === 'error');
    const blocked = score.qualityScore < threshold || Boolean(input.blockOnErrors ?? true) && blockingFindings.length > 0;
    const result: JsonObject = {
      schemaVersion: 1,
      gate: blocked ? 'blocked' : 'passed',
      blocked,
      qualityScore: score.qualityScore,
      threshold,
      blockingFindings: blockingFindings.slice(0, 20) as unknown as JsonObject[],
      qaRef: score.qaRef as unknown as JsonObject,
      nextSuggestedCalls: blocked ? ['qa.explain_score', 'patch.propose', 'qa.score_file'] : ['patch.preview', 'approval.request_apply'],
    };
    if (input.includeApplyPreviewScaffold) result.applyPreview = this.createApplyPreviewScaffold(score, threshold, blocked);
    return result;
  }

  compareVersions(input: QaCompareVersionsOptions): JsonObject {
    const versions = input.versions.map((version) => {
      const score = this.scoreFile({ sourcePath: input.sourcePath, targetPath: version.targetPath, metadataPath: version.metadataPath });
      const summary: JsonObject = { label: version.label, targetPath: score.targetPath, qualityScore: score.qualityScore, findingCount: score.findings.length };
      if (score.qaRef) summary.qaRef = score.qaRef as unknown as JsonObject;
      return summary;
    }).sort((left, right) => Number(right.qualityScore) - Number(left.qualityScore));
    return {
      schemaVersion: 1,
      best: versions[0] ?? null,
      versions: versions as unknown as JsonObject[],
      threshold: normalizeThreshold(input.threshold),
      nextSuggestedCalls: ['qa.threshold_gate', 'qa.explain_score'],
    };
  }

  createApplyPreviewScaffold(score: QaScoreResult, threshold = 0.9, blocked = score.qualityScore < threshold): JsonObject {
    return {
      schemaVersion: 1,
      dryRunOnly: true,
      applyExecutionChanged: false,
      targetPath: score.targetPath,
      qaGate: {
        gate: blocked ? 'blocked' : 'passed',
        qualityScore: score.qualityScore,
        threshold,
        qaRef: score.qaRef,
      } as unknown as JsonObject,
      message: blocked
        ? 'Apply preview is gated by deterministic QA. Repair findings and re-score before execution.'
        : 'QA gate passed for preview scaffolding. Actual apply execution remains unchanged.',
    };
  }

  private readScoreRef(scoreRefId?: string): QaScoreResult | undefined {
    if (!scoreRefId) return undefined;
    const read = this.options.dataRefs.readRef(scoreRefId);
    const payload = typeof read.content === 'object' && read.content && 'payload' in read.content
      ? (read.content as JsonObject).payload
      : read.content;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && (payload as { schemaVersion?: unknown }).schemaVersion === 1) {
      return payload as unknown as QaScoreResult;
    }
    return undefined;
  }
}

function assertTargetPath(input: QaScoreFileOptions): string {
  const targetPath = input.targetPath ?? input.path;
  if (typeof targetPath !== 'string' || targetPath.trim() === '') throw new Error('qa.score_file requires targetPath or path.');
  return targetPath;
}

function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/);
}

function alignmentFindings(alignment?: AlignmentInspectResult): QaFinding[] {
  if (!alignment) return [];
  return alignment.breaks.map((item) => finding(
    item.severity === 'error' ? 'error' : 'warning',
    item.code,
    item.code === 'line-count-drift' ? 'lineAlignment' : item.code === 'separator-drift' ? 'separatorPreservation' : item.code === 'control-code-drift' ? 'controlCodePreservation' : 'lineAlignment',
    item.message,
    item.targetLine ?? item.sourceLine,
  ));
}

function compareLineInvariants(sourceLines: string[] | undefined, targetLines: string[]): QaFinding[] {
  if (!sourceLines) return [];
  const findings: QaFinding[] = [];
  const max = Math.max(sourceLines.length, targetLines.length);
  for (let index = 0; index < max; index += 1) {
    const source = sourceLines[index] ?? '';
    const target = targetLines[index] ?? '';
    const lineNumber = index + 1;
    if (isSeparator(source) && source !== target) {
      findings.push(finding('error', 'separator-changed', 'separatorPreservation', `Separator must be preserved at line ${lineNumber}.`, lineNumber));
    }
    if (tokenSignature(controlCodes(source)) !== tokenSignature(controlCodes(target))) {
      findings.push(finding('error', 'control-code-changed', 'controlCodePreservation', `RPG control-code sequence changed at line ${lineNumber}.`, lineNumber));
    }
    if (tokenSignature(placeholders(source)) !== tokenSignature(placeholders(target))) {
      findings.push(finding('warning', 'placeholder-changed', 'placeholderPreservation', `Placeholder sequence changed at line ${lineNumber}.`, lineNumber));
    }
    const sourceSpeaker = speakerLabel(source);
    const targetSpeaker = speakerLabel(target);
    if (sourceSpeaker && targetSpeaker && sourceSpeaker !== targetSpeaker) {
      findings.push(finding('warning', 'speaker-label-changed', 'speakerConsistency', `Speaker label changed at line ${lineNumber}: ${sourceSpeaker} -> ${targetSpeaker}.`, lineNumber));
    }
  }
  return findings;
}

function untranslatedFindings(sourceLines: string[] | undefined, targetLines: string[]): QaFinding[] {
  const findings: QaFinding[] = [];
  for (let index = 0; index < targetLines.length; index += 1) {
    const target = targetLines[index];
    if (!target || isSeparator(target)) continue;
    const source = sourceLines?.[index];
    if (source && normalizeText(source) === normalizeText(target) && /[\p{Letter}\u3040-\u30ff\u3400-\u9fff]/u.test(target)) {
      findings.push(finding('warning', 'same-as-source', 'untranslatedText', `Target line ${index + 1} is unchanged from source.`, index + 1));
    } else if (/[\u3040-\u30ff]/.test(stripTokens(target))) {
      findings.push(finding('warning', 'kana-left-in-target', 'untranslatedText', `Target line ${index + 1} still contains kana characters.`, index + 1));
    }
  }
  return findings;
}

function glossaryFindings(entries: GlossaryEntry[], sourceLines: string[] | undefined, targetLines: string[], targetText: string): QaFinding[] {
  const sourceText = (sourceLines ?? []).join('\n');
  const findings: QaFinding[] = [];
  for (const entry of entries) {
    const sourcePresent = includesAny(sourceText, [entry.sourceText, ...entry.aliases]);
    if (sourcePresent && entry.preferredTranslation && !targetText.includes(entry.preferredTranslation)) {
      findings.push(finding('warning', 'preferred-glossary-missing', 'glossaryConsistency', `Preferred glossary translation missing for "${entry.sourceText}".`, undefined, { termId: entry.termId }));
    }
    for (const forbidden of entry.forbiddenTranslations) {
      const lineIndex = targetLines.findIndex((line) => forbidden && line.includes(forbidden));
      if (lineIndex >= 0) {
        findings.push(finding('error', 'forbidden-glossary-used', 'glossaryConsistency', `Forbidden glossary translation used for "${entry.sourceText}".`, lineIndex + 1, { termId: entry.termId, forbidden }));
      }
    }
  }
  return findings;
}

function styleFindings(memory: MemoryService, targetLines: string[]): QaFinding[] {
  const styleMemories = memory.search({ type: 'style-decision', limit: 20 }).concat(memory.search({ type: 'character-voice', limit: 20 }));
  if (!styleMemories.some((entry) => /polite|-요|존댓말/i.test(`${entry.summary}\n${entry.details ?? ''}`))) return [];
  const dialogueLines = targetLines.filter((line) => line && !isSeparator(line));
  const informal = dialogueLines.findIndex((line) => /[가-힣](다|해|야|지|군)[.!?…"]?$/.test(line.trim()) && !/(니다|요|세요|죠)[.!?…"]?$/.test(line.trim()));
  return informal >= 0
    ? [finding('info', 'style-memory-politeness-check', 'styleAdherence', 'Project memory mentions polite style; review this line for adherence.', informal + 1)]
    : [];
}

function fluencyFindings(targetLines: string[]): QaFinding[] {
  const findings: QaFinding[] = [];
  targetLines.forEach((line, index) => {
    if (/\b(TODO|MTL|FIXME)\b/i.test(line) || /\?{3,}|!{4,}|(.)\1{8,}/u.test(line)) {
      findings.push(finding('warning', 'fluency-marker', 'fluency', `Target line ${index + 1} contains a fluency placeholder or repeated marker.`, index + 1));
    }
  });
  return findings;
}

function lengthFindings(sourceLines: string[] | undefined, targetLines: string[]): QaFinding[] {
  if (!sourceLines) return [];
  const findings: QaFinding[] = [];
  for (let index = 0; index < Math.min(sourceLines.length, targetLines.length); index += 1) {
    const sourceLength = visibleLength(sourceLines[index]);
    const targetLength = visibleLength(targetLines[index]);
    if (sourceLength < 8 || targetLength === 0 || isSeparator(sourceLines[index])) continue;
    const ratio = targetLength / sourceLength;
    if (ratio > 2.5 || ratio < 0.25) {
      findings.push(finding('warning', 'line-length-anomaly', 'lengthAnomaly', `Line ${index + 1} length ratio is ${round3(ratio)}.`, index + 1));
    }
  }
  return findings;
}

function metadataRiskFindings(alignment: AlignmentInspectResult | undefined, targetLineCount: number): QaFinding[] {
  if (!alignment?.metadata) return [];
  const metadata = alignment.metadata as JsonObject;
  if (metadata.status === 'unrecognized') {
    return [finding('warning', 'metadata-unrecognized', 'jsonApplyRisk', 'Extracted metadata could not be parsed; apply risk is elevated.')];
  }
  const spans = Array.isArray(metadata.sampleSpans) ? metadata.sampleSpans as JsonObject[] : [];
  return spans
    .filter((span) => typeof span.endLine === 'number' && span.endLine > targetLineCount + 1)
    .map((span) => finding('error', 'metadata-span-out-of-range', 'jsonApplyRisk', 'Metadata span points past the target file line count.', Number(span.startLine)));
}

function scoreDimensions(findings: QaFinding[], alignment?: AlignmentInspectResult): QaDimensionScore[] {
  return DIMENSIONS.map((dimension) => {
    const dimensionFindings = findings.filter((item) => item.dimension === dimension.key);
    const alignmentScore = dimension.key === 'lineAlignment' && alignment ? alignment.score : 1;
    const penalty = dimensionFindings.reduce((sum, item) => sum + (item.severity === 'error' ? 0.35 : item.severity === 'warning' ? 0.18 : 0.05), 0);
    const score = round3(Math.max(0, Math.min(alignmentScore, 1 - penalty)));
    return {
      ...dimension,
      score,
      findingCount: dimensionFindings.length,
      status: dimensionFindings.some((item) => item.severity === 'error') ? 'fail' : dimensionFindings.length ? 'warn' : 'pass',
    };
  });
}

function nextCallsForScore(score: number, findings: QaFinding[]): string[] {
  if (score >= 0.9 && !findings.some((item) => item.severity === 'error')) return ['qa.threshold_gate', 'patch.preview'];
  const calls = ['qa.explain_score'];
  if (findings.some((item) => ['separatorPreservation', 'controlCodePreservation', 'placeholderPreservation', 'lineAlignment'].includes(item.dimension))) {
    calls.push('patch.propose');
  }
  calls.push('qa.score_file');
  return calls;
}

function alignmentSummary(alignment?: AlignmentInspectResult): JsonObject | undefined {
  if (!alignment) return undefined;
  return {
    score: alignment.score,
    confidence: alignment.confidence,
    lineCount: alignment.lineCount as unknown as JsonObject,
    breakCount: alignment.breaks.length,
    metadata: alignment.metadata,
    alignmentRef: alignment.alignmentRef as unknown as JsonObject,
  };
}

function scoreSummary(score: QaScoreResult): JsonObject {
  return {
    targetPath: score.targetPath,
    qualityScore: score.qualityScore,
    confidence: score.confidence,
    findingCount: score.findings.length,
    qaRef: score.qaRef as unknown as JsonObject,
    nextSuggestedCalls: score.nextSuggestedCalls,
  };
}

function finding(severity: QaFinding['severity'], code: string, dimension: QaDimension, message: string, lineNumber?: number, details?: JsonObject): QaFinding {
  return { severity, code, dimension, message, lineNumber, details };
}

function isSeparator(line: string): boolean {
  return /^---\s*[^-]+?\s*---$/.test(line);
}

function controlCodes(line: string): string[] {
  return line.match(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g) ?? [];
}

function placeholders(line: string): string[] {
  return line.match(/{{[^}\r\n]{1,40}}|{[A-Za-z0-9_]{1,40}}|%[sdif]|\$[A-Za-z_][A-Za-z0-9_]*|\[[A-Z_][A-Z0-9_]{1,40}\]/g) ?? [];
}

function speakerLabel(line: string): string | undefined {
  const match = line.match(/^\s*(?:\[([^\]\r\n]{1,32})\]|([^:：\r\n]{1,32})[:：])/);
  return (match?.[1] ?? match?.[2])?.trim();
}

function tokenSignature(tokens: string[]): string {
  return tokens.join('\u0000');
}

function stripTokens(line: string): string {
  return line.replace(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g, '');
}

function normalizeText(value: string): string {
  return stripTokens(value).replace(/\s+/g, ' ').trim();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => needle && haystack.includes(needle));
}

function visibleLength(line: string): number {
  return stripTokens(line).trim().length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.9;
}

function qualityConfidence(score: number): 'high' | 'medium' | 'low' {
  return score >= 0.9 ? 'high' : score >= 0.75 ? 'medium' : 'low';
}

function severitySort(left: QaFinding, right: QaFinding): number {
  const rank = { error: 0, warning: 1, info: 2 };
  return rank[left.severity] - rank[right.severity] || left.dimension.localeCompare(right.dimension, 'en');
}
