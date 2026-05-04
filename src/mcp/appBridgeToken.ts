import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { redactSecretLikeValues } from '../agent/contractsValidation';

export interface AppBridgeTokenRecord {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  bridgeKind: 'placeholder';
  redactedToken: '[REDACTED]';
}

export interface AppBridgeTokenIssue {
  token: string;
  record: AppBridgeTokenRecord;
}

export function issueAppBridgeToken(ttlMs = 10 * 60 * 1000, now = new Date()): AppBridgeTokenIssue {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    record: {
      tokenHash: hashBridgeToken(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      bridgeKind: 'placeholder',
      redactedToken: '[REDACTED]',
    },
  };
}

export function validateAppBridgeToken(record: AppBridgeTokenRecord, candidateToken: string, now = new Date()): boolean {
  if (!candidateToken || now.getTime() > Date.parse(record.expiresAt)) return false;
  const candidateHash = hashBridgeToken(candidateToken);
  const expected = Buffer.from(record.tokenHash, 'hex');
  const actual = Buffer.from(candidateHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function redactBridgeTokenPayload<T extends Record<string, unknown>>(payload: T): T {
  return redactSecretLikeValues(payload as never).value as unknown as T;
}

function hashBridgeToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex');
}
