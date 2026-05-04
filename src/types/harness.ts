export type HarnessStatus = 'passed' | 'failed' | 'skipped';
export type HarnessCaseStatus = Exclude<HarnessStatus, 'skipped'>;

export interface HarnessError {
  message: string;
  stack?: string;
}

export interface HarnessCaseResult {
  id: string;
  title: string;
  status: HarnessCaseStatus;
  durationMs: number;
  details?: unknown;
  error?: HarnessError;
}

export interface HarnessSuiteResult {
  schemaVersion: number;
  suite: string;
  status: HarnessStatus;
  startedAt?: string;
  completedAt?: string;
  total?: number;
  passed?: number;
  failed?: number;
  cases: HarnessCaseResult[];
  /** @deprecated Use cases. Kept for older artifact consumers. */
  results?: HarnessCaseResult[];
  score?: number;
  fatal?: boolean;
  error?: HarnessError;
  reason?: string;
  provider?: string;
  model?: string;
  metrics?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  reproCommand?: string;
  failureHints?: string[];
  processExitCode?: number;
}
