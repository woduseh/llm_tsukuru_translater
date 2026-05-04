import type {
  AgentResultEnvelope,
  ApprovalRequest,
  AuditEntry,
  FailureArtifact,
  GoldenWorkflowTranscript,
  JsonObject,
  JsonValue,
  PermissionTier,
  SandboxManifest,
  TerminalEvent,
} from '../types/agentWorkspace';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

type ValidationIssue = string;

const PERMISSION_TIERS: PermissionTier[] = ['readonly', 'workspace-write', 'approval-required', 'dangerous'];
const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|secret|token|bearer|password)\s*[:=]\s*[^\s,;]+/gi,
  /--(?:api[_-]?key|secret|token|password)\s+[^\s,;]+/gi,
  /\b(?:sk|ghp|github_pat|AIza)[A-Za-z0-9_\-]{12,}\b/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
];

export function validateAgentResultEnvelope(value: unknown): ValidationResult<AgentResultEnvelope> {
  const errors = validateEnvelopeShape(value, 'envelope');
  return toResult(value, errors);
}

export function validateApprovalRequest(value: unknown): ValidationResult<ApprovalRequest> {
  const errors: ValidationIssue[] = [];
  requireObject(value, 'approvalRequest', errors, (obj) => {
    requireSchemaVersion(obj, 'approvalRequest', errors);
    requireString(obj, 'approvalId', errors);
    requireString(obj, 'requestId', errors);
    requireString(obj, 'toolName', errors);
    requirePermissionTier(obj, 'permissionTier', errors, { allowReadonly: false });
    requireString(obj, 'reason', errors);
    optionalString(obj, 'planOperation', errors);
    requireStringArray(obj, 'affectedPaths', errors);
    optionalString(obj, 'argsHash', errors);
    optionalString(obj, 'previewArtifactPath', errors);
    optionalString(obj, 'previewRef', errors);
    optionalString(obj, 'confirmToken', errors);
    optionalString(obj, 'sessionId', errors);
    requireIsoDate(obj, 'expiresAt', errors);
    requireEnum(obj, 'status', ['pending', 'granted', 'denied', 'expired'], errors);
  });
  return toResult(value, errors);
}

export function validateTerminalEvent(value: unknown): ValidationResult<TerminalEvent> {
  const errors: ValidationIssue[] = [];
  requireObject(value, 'terminalEvent', errors, (obj) => {
    requireSchemaVersion(obj, 'terminalEvent', errors);
    requireString(obj, 'sessionId', errors);
    requireNumber(obj, 'sequence', errors);
    requireEnum(obj, 'kind', ['stdout', 'stderr', 'exit', 'started', 'error'], errors);
    requireIsoDate(obj, 'timestamp', errors);
    optionalString(obj, 'data', errors);
    optionalNumber(obj, 'exitCode', errors);
    requireBoolean(obj, 'redacted', errors);
  });
  return toResult(value, errors);
}

export function validateAuditEntry(value: unknown): ValidationResult<AuditEntry> {
  const errors: ValidationIssue[] = [];
  validateAuditEntryShape(value, 'auditEntry', errors);
  return toResult(value, errors);
}

export function validateFailureArtifact(value: unknown): ValidationResult<FailureArtifact> {
  const errors: ValidationIssue[] = [];
  validateFailureArtifactShape(value, 'failure', errors);
  return toResult(value, errors);
}

export function validateSandboxManifest(value: unknown): ValidationResult<SandboxManifest> {
  const errors: ValidationIssue[] = [];
  requireObject(value, 'sandboxManifest', errors, (obj) => {
    requireSchemaVersion(obj, 'sandboxManifest', errors);
    requireString(obj, 'sandboxId', errors);
    requireIsoDate(obj, 'createdAt', errors);
    requireString(obj, 'sourceRoot', errors);
    requireString(obj, 'sandboxRoot', errors);
    requireStringArray(obj, 'allowedRoots', errors);
    requireManifestEntries(obj, 'preManifest', errors);
    if ('postManifest' in obj) requireManifestEntries(obj, 'postManifest', errors);
  });
  return toResult(value, errors);
}

export function validateGoldenWorkflowTranscript(value: unknown): ValidationResult<GoldenWorkflowTranscript> {
  const errors: ValidationIssue[] = [];
  requireObject(value, 'goldenWorkflowTranscript', errors, (obj) => {
    requireSchemaVersion(obj, 'goldenWorkflowTranscript', errors);
    requireString(obj, 'workflowId', errors);
    requireIsoDate(obj, 'createdAt', errors);
    requireArray(obj, 'steps', errors, (item, index) => {
      requireObject(item, `steps[${index}]`, errors, (step) => {
        requireString(step, 'toolName', errors);
        requireString(step, 'requestId', errors);
        requireEnum(step, 'status', ['ok', 'needs-approval', 'failed'], errors);
        requirePermissionTier(step, 'permissionTier', errors);
      });
    });
    requireEnum(obj, 'finalStatus', ['ok', 'needs-approval', 'failed'], errors);
    requireStringArray(obj, 'artifacts', errors);
  });
  return toResult(value, errors);
}

export function redactSecretLikeValues<T extends JsonValue>(value: T): { value: T; redactions: string[] } {
  const redactions: string[] = [];
  const redacted = redactValue(value, redactions) as T;
  return { value: redacted, redactions: Array.from(new Set(redactions)) };
}

function validateEnvelopeShape(value: unknown, label: string): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  requireObject(value, label, errors, (obj) => {
    requireSchemaVersion(obj, label, errors);
    requireString(obj, 'requestId', errors);
    requireString(obj, 'toolName', errors);
    requireEnum(obj, 'status', ['ok', 'needs-approval', 'failed'], errors);
    requirePermissionTier(obj, 'permissionTier', errors);
    if ('approvalRequest' in obj) {
      errors.push(...validateApprovalRequest(obj.approvalRequest).errors.map((error) => `approvalRequest.${error}`));
    }
    if ('failure' in obj) validateFailureArtifactShape(obj.failure, 'failure', errors);
    requireArray(obj, 'audit', errors, (item, index) => validateAuditEntryShape(item, `audit[${index}]`, errors));
    requireStringArray(obj, 'redactions', errors);
    if ('warnings' in obj) requireStringArray(obj, 'warnings', errors);
  });
  return errors;
}

function validateAuditEntryShape(value: unknown, label: string, errors: ValidationIssue[]): void {
  requireObject(value, label, errors, (obj) => {
    requireSchemaVersion(obj, label, errors);
    requireString(obj, 'auditId', errors);
    requireIsoDate(obj, 'timestamp', errors);
    requireEnum(obj, 'kind', ['tool-call', 'approval', 'file-read', 'file-write', 'failure', 'handoff'], errors);
    requireEnum(obj, 'actor', ['user', 'agent', 'mcp', 'system'], errors);
    requireString(obj, 'action', errors);
    requirePermissionTier(obj, 'permissionTier', errors);
    optionalString(obj, 'requestId', errors);
    if ('paths' in obj) requireStringArray(obj, 'paths', errors);
    if ('metadata' in obj && !isPlainObject(obj.metadata)) errors.push('metadata must be an object');
  });
}

function validateFailureArtifactShape(value: unknown, label: string, errors: ValidationIssue[]): void {
  requireObject(value, label, errors, (obj) => {
    requireSchemaVersion(obj, label, errors);
    requireString(obj, 'failureId', errors);
    requireString(obj, 'requestId', errors);
    requireString(obj, 'stage', errors);
    requireString(obj, 'message', errors);
    requireBoolean(obj, 'retryable', errors);
    requireIsoDate(obj, 'createdAt', errors);
    if ('redactedDetails' in obj && !isPlainObject(obj.redactedDetails)) errors.push('redactedDetails must be an object');
    if ('handoff' in obj) {
      requireObject(obj.handoff, 'handoff', errors, (handoff) => {
        requireSchemaVersion(handoff, 'handoff', errors);
        requireString(handoff, 'handoffId', errors);
        requireIsoDate(handoff, 'createdAt', errors);
        requireString(handoff, 'summary', errors);
        requireStringArray(handoff, 'completedSteps', errors);
        requireStringArray(handoff, 'nextSteps', errors);
        requireStringArray(handoff, 'artifacts', errors);
        optionalString(handoff, 'failureId', errors);
      });
    }
  });
}

function redactValue(value: JsonValue, redactions: string[]): JsonValue {
  if (typeof value === 'string') return redactString(value, redactions);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactions));
  if (value && typeof value === 'object') {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|secret|token|password|credential|authorization|serviceAccountJson|private[_-]?key/i.test(key)) {
        redactions.push(key);
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactValue(child, redactions);
      }
    }
    return result;
  }
  return value;
}

function redactString(input: string, redactions: string[]): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      redactions.push(match.split(/[\s:=]/)[0]);
      return '[REDACTED]';
    });
  }
  return output;
}

function toResult<T>(value: unknown, errors: ValidationIssue[]): ValidationResult<T> {
  return errors.length === 0 ? { ok: true, value: value as T, errors: [] } : { ok: false, errors };
}

function requireObject(value: unknown, label: string, errors: ValidationIssue[], validate: (obj: Record<string, unknown>) => void): void {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  validate(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSchemaVersion(obj: Record<string, unknown>, label: string, errors: ValidationIssue[]): void {
  if (obj.schemaVersion !== 1) errors.push(`${label}.schemaVersion must be 1`);
}

function requireString(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  if (typeof obj[key] !== 'string' || obj[key] === '') errors.push(`${key} must be a non-empty string`);
}

function optionalString(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  if (key in obj && typeof obj[key] !== 'string') errors.push(`${key} must be a string`);
}

function requireNumber(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key])) errors.push(`${key} must be a finite number`);
}

function optionalNumber(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  if (key in obj && (typeof obj[key] !== 'number' || !Number.isFinite(obj[key]))) errors.push(`${key} must be a finite number`);
}

function requireBoolean(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  if (typeof obj[key] !== 'boolean') errors.push(`${key} must be boolean`);
}

function requireEnum(obj: Record<string, unknown>, key: string, values: string[], errors: ValidationIssue[]): void {
  if (typeof obj[key] !== 'string' || !values.includes(obj[key] as string)) errors.push(`${key} must be one of ${values.join(', ')}`);
}

function requirePermissionTier(obj: Record<string, unknown>, key: string, errors: ValidationIssue[], options: { allowReadonly?: boolean } = {}): void {
  const tiers = options.allowReadonly === false ? PERMISSION_TIERS.filter((tier) => tier !== 'readonly') : PERMISSION_TIERS;
  requireEnum(obj, key, tiers, errors);
}

function requireIsoDate(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  if (typeof obj[key] !== 'string' || Number.isNaN(Date.parse(obj[key] as string))) errors.push(`${key} must be an ISO date string`);
}

function requireStringArray(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  requireArray(obj, key, errors, (item, index) => {
    if (typeof item !== 'string') errors.push(`${key}[${index}] must be a string`);
  });
}

function requireArray(obj: Record<string, unknown>, key: string, errors: ValidationIssue[], validateItem: (item: unknown, index: number) => void): void {
  const value = obj[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return;
  }
  value.forEach(validateItem);
}

function requireManifestEntries(obj: Record<string, unknown>, key: string, errors: ValidationIssue[]): void {
  requireArray(obj, key, errors, (item, index) => {
    requireObject(item, `${key}[${index}]`, errors, (entry) => {
      requireString(entry, 'relativePath', errors);
      requireNumber(entry, 'sizeBytes', errors);
      requireNumber(entry, 'modifiedTimeMs', errors);
      requireString(entry, 'sha256', errors);
    });
  });
}
