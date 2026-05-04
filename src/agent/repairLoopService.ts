import type { AgentJob, JsonObject, TranslationPatch, TranslationPatchOperation } from '../types/agentWorkspace';
import type { AgentSafeFileSystem } from './agentSafeFileSystem';
import type { AgentArtifactRecord, ArtifactService } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import type { DataRefService } from './dataRefService';
import type { GlossaryEntry, GlossaryService } from './glossaryService';
import type { JobService } from './jobService';
import type { PatchPreviewResult, PatchProposeOptions, PatchService } from './patchService';
import type { QaFinding, QaScoreFileOptions, QaScoreResult, QaService } from './qaService';

export interface RepairLoopOptions extends QaScoreFileOptions {
  threshold?: number;
  maxIterations?: number;
  minAlignmentScore?: number;
  minAlignmentConfidence?: 'medium' | 'high';
  repairOperations?: Array<Partial<TranslationPatchOperation>>;
  dryRun?: boolean;
}

export interface RepairLoopPlanResult {
  schemaVersion: 1;
  loopId: string;
  createdAt: string;
  dryRunOnly: true;
  targetPath: string;
  sourcePath?: string;
  threshold: number;
  maxIterations: number;
  initialScore: QaScoreResult;
  findings: JsonObject[];
  classifications: JsonObject[];
  hardStops: JsonObject[];
  actions: JsonObject[];
  artifacts: JsonObject[];
  planRef?: AgentDataRef;
  nextSuggestedCalls: string[];
}

export interface RepairLoopRunResult {
  schemaVersion: 1;
  loopId: string;
  jobId: string;
  status: 'completed' | 'stopped' | 'blocked';
  dryRunOnly: true;
  threshold: number;
  iterations: JsonObject[];
  finalScore: number;
  stopReason: string;
  hardStops: JsonObject[];
  findings: JsonObject[];
  actions: JsonObject[];
  artifacts: JsonObject[];
  reportRef?: AgentDataRef;
  nextSuggestedCalls: string[];
}

export class RepairLoopService {
  private readonly records = new Map<string, RepairLoopRunResult>();

  constructor(
    private readonly options: {
      files: AgentSafeFileSystem;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
      jobs: JobService;
      qa: QaService;
      patch: PatchService;
      glossary: GlossaryService;
    },
  ) {}

  loopPlan(input: RepairLoopOptions): RepairLoopPlanResult {
    const score = this.options.qa.scoreFile(input);
    const threshold = normalizeThreshold(input.threshold);
    const maxIterations = positiveInt(input.maxIterations, 3);
    const loopId = `repair-loop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const hardStops = detectHardStops(score, input, this.options.glossary.search({ limit: 500 }));
    const classifications = score.findings.map((finding) => classifyFinding(finding));
    const actions = hardStops.length > 0 || score.qualityScore >= threshold
      ? []
      : proposeActions(score, input, this.options.files);
    const result: RepairLoopPlanResult = {
      schemaVersion: 1,
      loopId,
      createdAt: new Date().toISOString(),
      dryRunOnly: true,
      targetPath: score.targetPath,
      sourcePath: score.sourcePath,
      threshold,
      maxIterations,
      initialScore: score,
      findings: score.findings as unknown as JsonObject[],
      classifications: classifications as unknown as JsonObject[],
      hardStops: hardStops as unknown as JsonObject[],
      actions: actions as unknown as JsonObject[],
      artifacts: collectArtifacts(score),
      nextSuggestedCalls: planNextCalls(score, threshold, hardStops),
    };
    const artifact = this.options.artifacts.writeJsonArtifact('repair-loop-plan', loopId, result as unknown as JsonObject);
    result.artifacts.push(artifactSummary(artifact));
    result.planRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'repair-loop-plan',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'repair.loop_plan', targetPath: result.targetPath },
    });
    return result;
  }

  loopRun(input: RepairLoopOptions): RepairLoopRunResult {
    const plan = this.loopPlan(input);
    const job = this.options.jobs.createJob({
      kind: 'repair.loop',
      title: `Auto repair loop: ${plan.targetPath}`,
      permissionTier: 'readonly',
      input: { targetPath: plan.targetPath, sourcePath: plan.sourcePath ?? null, threshold: plan.threshold, dryRunOnly: true },
    });
    this.options.jobs.updateStatus(job.jobId, 'running', 'dry-run repair loop started');

    const iterations: JsonObject[] = [];
    const hardStops = [...plan.hardStops];
    let currentScore = plan.initialScore.qualityScore;
    let stopReason = '';
    let status: RepairLoopRunResult['status'] = 'completed';
    let regressionCount = 0;

    if (plan.initialScore.qualityScore >= plan.threshold && hardStops.length === 0) {
      stopReason = 'threshold-reached';
    } else if (hardStops.length > 0) {
      stopReason = String(hardStops[0].code ?? 'hard-stop');
      status = 'blocked';
    } else if (plan.maxIterations <= 0) {
      stopReason = 'max-iterations-exceeded';
      status = 'stopped';
    } else {
      for (let index = 0; index < plan.maxIterations; index += 1) {
        const iteration = simulateIteration(index + 1, plan, input, this.options.patch, this.options.files);
        iterations.push(iteration as unknown as JsonObject);
        const iterationHardStop = iteration.hardStop as JsonObject | undefined;
        if (iterationHardStop) {
          hardStops.push(iterationHardStop);
          stopReason = String(iterationHardStop.code ?? 'hard-stop');
          status = 'blocked';
          break;
        }
        const simulatedScore = typeof iteration.simulatedScore === 'number' ? iteration.simulatedScore : currentScore;
        regressionCount = simulatedScore < currentScore ? regressionCount + 1 : 0;
        currentScore = simulatedScore;
        if (regressionCount >= 2) {
          hardStops.push(hardStop('repeated-score-regression', 'Simulated repair score regressed twice in a row.'));
          stopReason = 'repeated-score-regression';
          status = 'blocked';
          break;
        }
        if (currentScore >= plan.threshold) {
          stopReason = 'threshold-reached';
          break;
        }
      }
      if (!stopReason) {
        stopReason = 'max-iterations-exceeded';
        status = 'stopped';
      }
    }

    const run: RepairLoopRunResult = {
      schemaVersion: 1,
      loopId: plan.loopId,
      jobId: job.jobId,
      status,
      dryRunOnly: true,
      threshold: plan.threshold,
      iterations,
      finalScore: round3(currentScore),
      stopReason,
      hardStops,
      findings: plan.findings,
      actions: plan.actions,
      artifacts: [...plan.artifacts],
      nextSuggestedCalls: status === 'blocked'
        ? ['repair.loop_report', 'qa.explain_score', 'alignment.explain']
        : ['repair.loop_report', currentScore >= plan.threshold ? 'qa.threshold_gate' : 'repair.loop_plan'],
    };
    const artifact = this.options.artifacts.writeJsonArtifact('repair-loop-report', plan.loopId, run as unknown as JsonObject, job.jobId);
    run.artifacts.push(artifactSummary(artifact));
    run.reportRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'repair-loop-report',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'repair.loop_run', targetPath: plan.targetPath, jobId: job.jobId },
    });
    this.records.set(run.loopId, run);
    this.options.jobs.updateProgress(job.jobId, { completed: iterations.length, total: Math.max(1, plan.maxIterations), message: stopReason });
    this.options.jobs.updateStatus(job.jobId, status === 'blocked' ? 'blocked' : 'completed', stopReason);
    return run;
  }

  loopStatus(input: { loopId?: string; jobId?: string }): JsonObject {
    const record = input.loopId ? this.records.get(input.loopId) : undefined;
    const job = input.jobId ? this.options.jobs.getJob(input.jobId) : record ? this.options.jobs.getJob(record.jobId) : undefined;
    return {
      schemaVersion: 1,
      loopId: record?.loopId ?? input.loopId ?? null,
      job: jobSummary(job),
      status: record?.status ?? job?.status ?? 'unknown',
      stopReason: record?.stopReason ?? job?.progress.message ?? null,
      nextSuggestedCalls: record ? ['repair.loop_report'] : ['repair.loop_run', 'job.graph_status'],
    };
  }

  loopStop(input: { loopId?: string; jobId?: string; reason?: string }): JsonObject {
    const record = input.loopId ? this.records.get(input.loopId) : undefined;
    const jobId = input.jobId ?? record?.jobId;
    if (!jobId) throw new Error('repair.loop_stop requires loopId or jobId.');
    const job = this.options.jobs.updateStatus(jobId, 'cancelled', input.reason ?? 'repair loop stopped');
    if (record) {
      record.status = 'stopped';
      record.stopReason = input.reason ?? 'manual-stop';
      record.nextSuggestedCalls = ['repair.loop_report'];
    }
    return {
      schemaVersion: 1,
      loopId: record?.loopId ?? input.loopId ?? null,
      job: jobSummary(job),
      stopped: true,
      nextSuggestedCalls: ['repair.loop_report'],
    };
  }

  loopReport(input: { loopId?: string; jobId?: string }): JsonObject {
    const record = input.loopId ? this.records.get(input.loopId) : Array.from(this.records.values()).find((item) => item.jobId === input.jobId);
    if (!record) throw new Error('repair.loop_report requires a known loopId or jobId from repair.loop_run.');
    return {
      schemaVersion: 1,
      loopId: record.loopId,
      jobId: record.jobId,
      status: record.status,
      stopReason: record.stopReason,
      quality: { threshold: record.threshold, finalScore: record.finalScore },
      findings: record.findings,
      actions: record.actions,
      artifacts: record.artifacts,
      hardStops: record.hardStops,
      nextSuggestedCalls: record.nextSuggestedCalls,
    };
  }
}

function simulateIteration(
  iteration: number,
  plan: RepairLoopPlanResult,
  input: RepairLoopOptions,
  patch: PatchService,
  files: AgentSafeFileSystem,
): JsonObject {
  const actions = plan.actions;
  const patchAction = actions.find((action) => action.kind === 'patch' && typeof action.lineNumber === 'number');
  const explicitOperations = input.repairOperations?.length ? input.repairOperations : undefined;
  if (!patchAction && !explicitOperations) {
    return {
      iteration,
      status: 'planned-unavailable',
      simulatedScore: plan.initialScore.qualityScore,
      actionsConsidered: actions,
      message: 'Only provider retranslation or manual alignment repairs are available for these findings in this scaffold.',
    };
  }
  const proposeInput = buildPatchProposal(plan, patchAction, explicitOperations);
  const proposed = patch.propose(proposeInput);
  const conflict = detectPatchConflict(proposed.patch, files);
  let preview: PatchPreviewResult | undefined;
  if (!conflict) preview = patch.preview(proposed.patch);
  const invalid = conflict ?? proposed.validation.findings.find((finding) => finding.severity === 'error') ?? preview?.validation.findings.find((finding) => finding.severity === 'error');
  if (invalid) {
    return {
      iteration,
      status: 'hard-stop',
      patchRef: proposed.patchRef as unknown as JsonObject,
      hardStop: hardStop('patch-conflict', String(invalid.message ?? invalid.code ?? 'Patch proposal conflicts with current target.')),
    };
  }
  const repairedCount = Math.max(1, proposed.patch.operations.filter((operation) => operation.kind === 'replace-line').length);
  return {
    iteration,
    status: 'simulated',
    dryRunOnly: true,
    patchRef: proposed.patchRef as unknown as JsonObject,
    preview: preview as unknown as JsonObject,
    simulatedScore: round3(Math.min(1, plan.initialScore.qualityScore + repairedCount * 0.08 * iteration)),
    nextSuggestedCalls: ['patch.preview', 'qa.score_file'],
  };
}

function buildPatchProposal(
  plan: RepairLoopPlanResult,
  patchAction: JsonObject | undefined,
  explicitOperations?: Array<Partial<TranslationPatchOperation>>,
): PatchProposeOptions {
  if (explicitOperations?.length) {
    return {
      targetPath: plan.targetPath,
      operations: explicitOperations.map((operation, index) => ({
        opId: operation.opId ?? `op-${String(index + 1).padStart(3, '0')}`,
        kind: operation.kind ?? 'replace-line',
        targetPath: plan.targetPath,
        lineNumber: Number(operation.lineNumber ?? 1),
        originalText: operation.originalText,
        replacementText: operation.replacementText,
        note: operation.note,
        alignmentProofRef: operation.alignmentProofRef,
      })),
    };
  }
  return {
    targetPath: plan.targetPath,
    lineNumber: Number(patchAction?.lineNumber ?? 1),
    replacementText: String(patchAction?.replacementText ?? ''),
    note: typeof patchAction?.note === 'string' ? patchAction.note : undefined,
    alignmentRef: typeof patchAction?.alignmentRef === 'string' ? patchAction.alignmentRef : undefined,
  };
}

function detectPatchConflict(patch: TranslationPatch, files: AgentSafeFileSystem): JsonObject | undefined {
  const read = files.readText(patch.targetPath, { maxBytes: 256 * 1024 });
  const lines = read.text.split(/\r?\n/);
  for (const operation of patch.operations) {
    if (operation.originalText !== undefined && lines[operation.lineNumber - 1] !== operation.originalText) {
      return { severity: 'error', code: 'original-text-mismatch', message: `Patch original text mismatch at line ${operation.lineNumber}.` };
    }
  }
  return undefined;
}

function proposeActions(score: QaScoreResult, input: RepairLoopOptions, files: AgentSafeFileSystem): JsonObject[] {
  const actions: JsonObject[] = [];
  const sourceLines = input.sourcePath ? safeLines(files, input.sourcePath) : [];
  const repairableCodes = new Set(['separator-drift', 'separator-changed', 'control-code-drift', 'control-code-changed', 'placeholder-changed', 'empty-line-drift', 'speaker-label-changed']);
  const alignmentRef = typeof score.alignment?.alignmentRef === 'object' && score.alignment?.alignmentRef !== null
    ? String((score.alignment.alignmentRef as JsonObject).refId ?? '')
    : undefined;
  for (const finding of score.findings) {
    if (finding.lineNumber && repairableCodes.has(finding.code) && sourceLines[finding.lineNumber - 1] !== undefined) {
      const action: JsonObject = {
        kind: 'patch',
        actionId: `patch-line-${finding.lineNumber}`,
        lineNumber: finding.lineNumber,
        replacementText: sourceLines[finding.lineNumber - 1],
        findingCode: finding.code,
        confidence: score.alignment?.confidence ?? score.confidence,
      };
      if (alignmentRef) action.alignmentRef = alignmentRef;
      actions.push(action);
      continue;
    }
    if (finding.dimension === 'glossaryConsistency') {
      actions.push({ kind: 'patch', actionId: `glossary-note-${finding.lineNumber ?? actions.length + 1}`, findingCode: finding.code, lineNumber: finding.lineNumber ?? 1, note: 'Review glossary-consistent replacement; scaffold does not rewrite prose automatically.' });
    } else if (['untranslatedText', 'fluency', 'lengthAnomaly'].includes(finding.dimension)) {
      actions.push({ kind: 'retranslation', actionId: `provider-retranslate-${actions.length + 1}`, findingCode: finding.code, available: false, reason: 'Provider retranslation is planned but unavailable in this dry-run scaffold.' });
    }
  }
  return dedupeActions(actions);
}

function detectHardStops(score: QaScoreResult, input: RepairLoopOptions, glossaryEntries: GlossaryEntry[]): JsonObject[] {
  const hardStops: JsonObject[] = [];
  const alignment = score.alignment;
  const lineCount = alignment?.lineCount as JsonObject | undefined;
  if (score.findings.some((finding) => finding.code === 'line-count-drift') || Number(lineCount?.delta ?? 0) !== 0) {
    hardStops.push(hardStop('line-count-uncertainty', 'Source/target line counts differ; automatic repair cannot prove .extracteddata alignment.'));
  }
  if (score.findings.some((finding) => finding.code === 'truncated-read')) {
    hardStops.push(hardStop('line-count-uncertainty', 'One or more bounded reads were truncated; line-count certainty is unavailable.'));
  }
  if (alignment?.confidence === 'low' || typeof alignment?.score === 'number' && alignment.score < (input.minAlignmentScore ?? 0.5)) {
    hardStops.push(hardStop('low-alignment-confidence', 'Alignment confidence is too low for automatic patch planning.'));
  }
  const glossaryConflict = findGlossaryConflict(glossaryEntries);
  if (glossaryConflict) hardStops.push(hardStop('conflicting-glossary-rules', glossaryConflict));
  return hardStops;
}

function findGlossaryConflict(entries: GlossaryEntry[]): string | undefined {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    if (left.forbiddenTranslations.includes(left.preferredTranslation)) return `Glossary term ${left.termId} forbids its preferred translation.`;
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (normalize(left.sourceText) === normalize(right.sourceText) && left.preferredTranslation !== right.preferredTranslation) {
        return `Glossary terms ${left.termId} and ${right.termId} conflict for ${left.sourceText}.`;
      }
    }
  }
  return undefined;
}

function classifyFinding(finding: QaFinding): JsonObject {
  const repairClass = finding.code === 'line-count-drift'
    ? 'hard-stop'
    : ['separatorPreservation', 'controlCodePreservation', 'placeholderPreservation', 'lineAlignment'].includes(finding.dimension)
      ? 'alignment-or-patch'
      : finding.dimension === 'glossaryConsistency'
        ? 'glossary-guided-patch'
        : ['untranslatedText', 'fluency', 'lengthAnomaly'].includes(finding.dimension)
          ? 'provider-retranslation-planned'
          : 'review';
  return { code: finding.code, severity: finding.severity, dimension: finding.dimension, lineNumber: finding.lineNumber ?? null, repairClass };
}

function planNextCalls(score: QaScoreResult, threshold: number, hardStops: JsonObject[]): string[] {
  if (hardStops.length > 0) return ['repair.loop_report', 'alignment.explain', 'qa.explain_score'];
  if (score.qualityScore >= threshold) return ['qa.threshold_gate', 'patch.preview'];
  return ['repair.loop_run', 'patch.preview', 'qa.score_file'];
}

function collectArtifacts(score: QaScoreResult): JsonObject[] {
  const artifacts: JsonObject[] = [];
  if (score.qaRef) artifacts.push({ kind: 'qa-score', refId: score.qaRef.refId });
  const alignment = score.alignment;
  if (alignment && typeof alignment.alignmentRef === 'object' && alignment.alignmentRef !== null) {
    artifacts.push({ kind: 'alignment-map', refId: (alignment.alignmentRef as JsonObject).refId ?? null });
  }
  return artifacts;
}

function artifactSummary(artifact: AgentArtifactRecord): JsonObject {
  return { artifactId: artifact.artifactId, kind: artifact.kind, path: artifact.path };
}

function jobSummary(job?: AgentJob): JsonObject | null {
  if (!job) return null;
  return { jobId: job.jobId, kind: job.kind, status: job.status, progress: job.progress as unknown as JsonObject, artifactPaths: job.artifactPaths };
}

function safeLines(files: AgentSafeFileSystem, filePath: string): string[] {
  try {
    return files.readText(filePath, { maxBytes: 256 * 1024 }).text.split(/\r?\n/);
  } catch {
    return [];
  }
}

function hardStop(code: string, message: string): JsonObject {
  return { severity: 'error', code, message };
}

function dedupeActions(actions: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.lineNumber ?? ''}:${action.findingCode ?? ''}:${action.replacementText ?? action.note ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.9;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
