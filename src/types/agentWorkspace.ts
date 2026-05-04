export const AGENT_CONTRACT_SCHEMA_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type PermissionTier = 'readonly' | 'workspace-write' | 'approval-required' | 'dangerous';
export type ApprovalStatus = 'pending' | 'granted' | 'denied' | 'expired';
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
  | 'pty-spawn-failed';
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

export interface FileManifestEntry {
  relativePath: string;
  sizeBytes: number;
  modifiedTimeMs: number;
  sha256: string;
}

export interface SandboxManifest {
  schemaVersion: 1;
  sandboxId: string;
  createdAt: string;
  sourceRoot: string;
  sandboxRoot: string;
  allowedRoots: string[];
  preManifest: FileManifestEntry[];
  postManifest?: FileManifestEntry[];
}

export interface GoldenWorkflowStep {
  toolName: string;
  requestId: string;
  status: AgentResultStatus;
  permissionTier: PermissionTier;
}

export interface GoldenWorkflowTranscript {
  schemaVersion: 1;
  workflowId: string;
  createdAt: string;
  steps: GoldenWorkflowStep[];
  finalStatus: AgentResultStatus;
  artifacts: string[];
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
