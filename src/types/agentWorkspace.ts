export const AGENT_CONTRACT_SCHEMA_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type PermissionTier = 'readonly' | 'workspace-write' | 'approval-required' | 'dangerous';
export type ApprovalStatus = 'pending' | 'granted' | 'denied' | 'expired' | 'stale' | 'cancelled';
export type TerminalEventKind = 'stdout' | 'stderr' | 'exit' | 'started' | 'error' | 'truncated';
export type TerminalSessionKind = 'codex' | 'claude' | 'shell' | 'custom';
export type TerminalSessionState = 'created' | 'starting' | 'running' | 'idle' | 'exited' | 'failed' | 'killed' | 'unavailable' | 'reconnecting';
export type TerminalCapabilityStatus = 'enabled' | 'degraded' | 'unavailable';
export type TerminalErrorCode =
  | 'terminal-unavailable'
  | 'invalid-request'
  | 'no-trusted-project'
  | 'cwd-denied'
  | 'executable-missing'
  | 'session-not-found'
  | 'input-too-large'
  | 'paste-confirmation-required'
  | 'pty-spawn-failed'
  | 'process-exited-early';
export type AuditEntryKind = 'tool-call' | 'approval' | 'file-read' | 'file-write' | 'failure' | 'handoff';
export type AgentResultStatus = 'ok' | 'needs-approval' | 'failed';

export interface AgentResultEnvelope<TPayload extends JsonValue = JsonObject> {
  schemaVersion: 1;
  requestId: string;
  toolName: string;
  status: AgentResultStatus;
  permissionTier: PermissionTier;
  payload?: TPayload;
  qualityScore?: number;
  nextSuggestedCalls?: string[];
  approvalRequest?: ApprovalRequest;
  failure?: FailureArtifact;
  audit: AuditEntry[];
  redactions: string[];
  warnings?: string[];
}

export interface ApprovalRequest {
  schemaVersion: 1;
  approvalId: string;
  requestId: string;
  toolName: string;
  permissionTier: Exclude<PermissionTier, 'readonly'>;
  reason: string;
  planOperation?: string;
  affectedPaths: string[];
  argsHash?: string;
  previewArtifactPath?: string;
  previewRef?: string;
  confirmToken?: string;
  sessionId?: string;
  expiresAt: string;
  status: ApprovalStatus;
}

export type MutationApprovalStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'denied'
  | 'expired'
  | 'stale'
  | 'failed'
  | 'cancelled';

export interface MutationApprovalPreviewLine {
  opId: string;
  lineNumber: number;
  before: string;
  after: string;
}

export interface MutationApprovalPreview {
  schemaVersion: 1;
  targetPath: string;
  operations: MutationApprovalPreviewLine[];
  serializedBytes: number;
}

export interface MutationApprovalInvariantSummary {
  schemaVersion: 1;
  lineCountPreserved: true;
  separatorsPreserved: true;
  emptyLinesPreserved: true;
  controlCodesPreserved: true;
}

export interface MutationApprovalResultView {
  schemaVersion: 1;
  applied: true;
  targetPath: string;
  operationsApplied: number;
}

export interface MutationApprovalFailureView {
  schemaVersion: 1;
  code: string;
  message: string;
  retryable: boolean;
}

interface MutationApprovalViewBase {
  schemaVersion: 1;
  approvalId: string;
  requestId: string;
  toolName: 'patch.apply';
  status: MutationApprovalStatus;
  requestSource: 'mcp' | 'renderer';
  projectLabel: string;
  affectedPaths: string[];
  preview: MutationApprovalPreview;
  invariants: MutationApprovalInvariantSummary;
  createdAt: string;
  expiresAt: string;
  result?: MutationApprovalResultView;
  failure?: MutationApprovalFailureView;
}

export interface MutationApprovalRendererView extends MutationApprovalViewBase {
  denialNote?: string;
}

export type MutationApprovalBridgeView = MutationApprovalViewBase;

export interface PatchApplyProposalRequest {
  schemaVersion: 1;
  requestId: string;
  idempotencyKey: string;
  toolName: 'patch.apply';
  patch: TranslationPatch;
}

export interface MutationApprovalListRequest {
  schemaVersion: 1;
  statuses?: MutationApprovalStatus[];
}

export interface MutationApprovalGetRequest {
  schemaVersion: 1;
  approvalId: string;
}

export interface MutationApprovalApproveRequest {
  schemaVersion: 1;
  approvalId: string;
}

export interface MutationApprovalDenyRequest {
  schemaVersion: 1;
  approvalId: string;
  note?: string;
}

export interface MutationApprovalQueueSnapshot {
  schemaVersion: 1;
  approvals: MutationApprovalRendererView[];
  pendingCount: number;
}

export interface MutationApprovalOperationResult {
  schemaVersion: 1;
  ok: boolean;
  approval?: MutationApprovalRendererView;
  approvals?: MutationApprovalRendererView[];
  snapshot?: MutationApprovalQueueSnapshot;
  errorCode?: string;
  message?: string;
}

export interface TerminalEvent {
  schemaVersion: 1;
  sessionId: string;
  sequence: number;
  kind: TerminalEventKind;
  timestamp: string;
  data?: string;
  exitCode?: number;
  redacted: boolean;
  omittedBytes?: number;
  errorCode?: TerminalErrorCode;
}

export interface TerminalSessionSummary {
  schemaVersion: 1;
  sessionId: string;
  label: string;
  kind: TerminalSessionKind;
  state: TerminalSessionState;
  cwdLabel: string;
  outputRetention: 'ephemeral' | 'persisted';
  persistOutput: boolean;
  exitCode?: number;
  executableLabel?: string;
  commandPreview?: string;
  latestSequence: number;
  bridgeAttached: boolean;
  redactionCount: number;
  truncationCount: number;
}

export interface TerminalSessionCreateRequest {
  schemaVersion: 1;
  requestId: string;
  kind: TerminalSessionKind;
  label?: string;
  cwd?: string;
  commandPresetId?: string;
  executable?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  persistOutput?: boolean;
  allowCustomCommand?: boolean;
}

export interface TerminalInputRequest {
  schemaVersion: 1;
  sessionId: string;
  data: string;
  paste?: boolean;
  confirmed?: boolean;
}

export interface TerminalResizeRequest {
  schemaVersion: 1;
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalKillRequest {
  schemaVersion: 1;
  sessionId: string;
}

export interface TerminalSnapshotRequest {
  schemaVersion: 1;
  sessionId: string;
  afterSequence?: number;
}

export interface TerminalSnapshot {
  schemaVersion: 1;
  session: TerminalSessionSummary;
  events: TerminalEvent[];
  truncatedBeforeSequence?: number;
}

export interface TerminalCapability {
  schemaVersion: 1;
  status: TerminalCapabilityStatus;
  nativePtyAvailable: boolean;
  reason?: string;
  fallbackHint?: string;
}

export interface TerminalOperationResult {
  schemaVersion: 1;
  ok: boolean;
  session?: TerminalSessionSummary;
  sessions?: TerminalSessionSummary[];
  snapshot?: TerminalSnapshot;
  capability?: TerminalCapability;
  errorCode?: TerminalErrorCode;
  message?: string;
}

export interface AuditEntry {
  schemaVersion: 1;
  auditId: string;
  timestamp: string;
  kind: AuditEntryKind;
  actor: 'user' | 'agent' | 'mcp' | 'system';
  action: string;
  permissionTier: PermissionTier;
  requestId?: string;
  paths?: string[];
  metadata?: JsonObject;
}

export interface FailureArtifact {
  schemaVersion: 1;
  failureId: string;
  requestId: string;
  stage: string;
  message: string;
  retryable: boolean;
  createdAt: string;
  redactedDetails?: JsonObject;
  handoff?: HandoffArtifact;
}

export interface HandoffArtifact {
  schemaVersion: 1;
  handoffId: string;
  createdAt: string;
  summary: string;
  completedSteps: string[];
  nextSteps: string[];
  artifacts: string[];
  failureId?: string;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  permissionTier: PermissionTier;
  inputSchema: JsonObject;
}

export type AgentJobStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export interface AgentJobProgress {
  completed: number;
  total: number;
  message?: string;
  updatedAt: string;
}

export interface AgentJobSummary {
  jobId: string;
  kind: string;
  title: string;
  status: AgentJobStatus;
  updatedAt: string;
  progress: AgentJobProgress;
}

export interface AgentJob extends AgentJobSummary {
  schemaVersion: 1;
  permissionTier: PermissionTier;
  createdBy: 'user' | 'agent' | 'mcp' | 'system';
  createdAt: string;
  completedAt?: string;
  input: JsonObject;
  artifactPaths: string[];
  events: string[];
  failure?: FailureArtifact;
}

export interface AgentProjectManifest {
  schemaVersion: 1;
  generatedAt: string;
  engine: {
    name: string;
    projectPath: string;
  };
  projectPath: string;
  workspacePath: string;
  translationInventory: JsonObject;
  providerMetadata: JsonObject;
  qualityRules: string[];
  availableTools: McpToolDefinition[];
  currentJobs: AgentJobSummary[];
  lastFailures: FailureArtifact[];
}

export interface AlignmentLineRef {
  sourceLine: number;
  targetLine?: number;
  confidence: number;
  kind: 'separator' | 'empty' | 'text';
  reasons: string[];
}

export interface AlignmentBreak {
  code: string;
  severity: 'info' | 'warning' | 'error';
  sourceLine?: number;
  targetLine?: number;
  message: string;
}

export interface AlignmentMap {
  schemaVersion: 1;
  alignmentId: string;
  createdAt: string;
  sourcePath: string;
  targetPath: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  coverage: 'full' | 'partial';
  verified: boolean;
  scoreKind: 'observed-structural';
  limitations: string[];
  lineCount: {
    source: number;
    target: number;
    delta: number;
  };
  refs: AlignmentLineRef[];
  breaks: AlignmentBreak[];
  metadata: JsonObject;
}

export interface TranslationPatchOperation {
  opId: string;
  kind: 'replace-line' | 'virtual-note';
  targetPath: string;
  lineNumber: number;
  originalText?: string;
  replacementText?: string;
  note?: string;
  alignmentProofRef?: string;
}

export interface TranslationPatch {
  schemaVersion: 1;
  patchId: string;
  createdAt: string;
  dryRunOnly: true;
  targetPath: string;
  operations: TranslationPatchOperation[];
  alignmentRef?: string;
  invariantPolicy: {
    preserveLineCount: true;
    requiresAlignmentProofForLineCountChange: true;
  };
}
