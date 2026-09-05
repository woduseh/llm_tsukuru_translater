import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export interface AppBridgeTokenRecord {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  bridgeKind: 'loopback-v1';
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
      bridgeKind: 'loopback-v1',
      redactedToken: '[REDACTED]',
    },
  };
}

export function validateAppBridgeToken(
  record: AppBridgeTokenRecord,
  candidateToken: string,
  now = new Date(),
): boolean {
  if (!candidateToken || now.getTime() > Date.parse(record.expiresAt)) return false;
  const candidateHash = hashBridgeToken(candidateToken);
  const expected = Buffer.from(record.tokenHash, 'hex');
  const actual = Buffer.from(candidateHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashBridgeToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex');
}
