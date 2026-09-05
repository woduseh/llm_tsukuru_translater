import type {
  MutationApprovalBridgeView,
  MutationApprovalStatus,
  TranslationPatch,
} from '../types/agentWorkspace';

export const AGENT_BRIDGE_SCHEMA_VERSION = 1;
export const AGENT_BRIDGE_HOST = '127.0.0.1';
export const AGENT_BRIDGE_MANIFEST_DIRECTORY = 'llm-tsukuru-agent-bridge';
export const AGENT_BRIDGE_MANIFEST_NAME = 'llm-tsukuru-agent-bridge-v1.json';
export const AGENT_BRIDGE_BODY_LIMIT = 256 * 1024;
export const AGENT_BRIDGE_SUBMISSION_RATE = 10;
export const AGENT_BRIDGE_RATE_WINDOW_MS = 60 * 1000;

export interface AgentBridgeManifest {
  schemaVersion: 1;
  host: '127.0.0.1';
  port: number;
  token: string;
  appSessionId: string;
  bridgeSessionId: string;
  projectHash: string;
  issuedAt: string;
}

export interface AgentBridgePatchApplyRequest {
  schemaVersion: 1;
  requestId: string;
  idempotencyKey: string;
  toolName: 'patch.apply';
  patch: TranslationPatch;
}

export interface AgentBridgePatchApplyResponse {
  schemaVersion: 1;
  status: 'needs-approval';
  approval: MutationApprovalBridgeView;
  polling: {
    toolName: 'approval.status';
    approvalId: string;
  };
}

export interface AgentBridgeApprovalStatusResponse {
  schemaVersion: 1;
  status: MutationApprovalStatus;
  approval: MutationApprovalBridgeView;
}

export interface AgentBridgeStatusResponse {
  schemaVersion: 1;
  available: true;
  approvalRequired: true;
  operations: string[];
  limits: { targetFileBytes: number; operations: number; lineBytes: number };
  execution: string;
}

export interface AgentBridgeErrorResponse {
  schemaVersion: 1;
  error: {
    code: string;
    message: string;
  };
}

export function isAgentBridgeManifest(value: unknown): value is AgentBridgeManifest {
  if (!isObject(value)) return false;
  return value.schemaVersion === AGENT_BRIDGE_SCHEMA_VERSION
    && value.host === AGENT_BRIDGE_HOST
    && typeof value.port === 'number'
    && Number.isInteger(value.port)
    && value.port > 0
    && value.port <= 65535
    && isBoundedString(value.token, 256)
    && isBoundedString(value.appSessionId, 256)
    && isBoundedString(value.bridgeSessionId, 256)
    && /^[a-f0-9]{64}$/.test(String(value.projectHash))
    && typeof value.issuedAt === 'string'
    && !Number.isNaN(Date.parse(value.issuedAt));
}

export function hashAgentBridgeProjectBinding(projectRoot: string): string {
  const normalized = process.platform === 'win32'
    ? path.resolve(projectRoot).toLowerCase()
    : path.resolve(projectRoot);
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

export function isProtectedAgentBridgePath(filePath: string): boolean {
  return path.resolve(filePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase() === AGENT_BRIDGE_MANIFEST_DIRECTORY);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}
import * as crypto from 'crypto';
import * as path from 'path';
