import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {
  AGENT_BRIDGE_BODY_LIMIT,
  AGENT_BRIDGE_HOST,
  AGENT_BRIDGE_MANIFEST_DIRECTORY,
  AGENT_BRIDGE_MANIFEST_NAME,
  AGENT_BRIDGE_RATE_WINDOW_MS,
  AGENT_BRIDGE_SCHEMA_VERSION,
  AGENT_BRIDGE_SUBMISSION_RATE,
  hashAgentBridgeProjectBinding,
  type AgentBridgeApprovalStatusResponse,
  type AgentBridgeStatusResponse,
  type AgentBridgeErrorResponse,
  type AgentBridgeManifest,
  type AgentBridgePatchApplyResponse,
} from './agentBridgeContracts';
import {
  MutationApprovalRuntimeError,
  type MutationApprovalRuntime,
} from './mutationApprovalRuntime';
import { issueAppBridgeToken, validateAppBridgeToken } from './agentBridgeToken';
import { MUTATION_APPROVAL_LIMITS } from './mutationApprovalContracts';

export interface AgentBridgeServerOptions {
  runtime: MutationApprovalRuntime;
  userDataPath: string;
  now?: () => Date;
}

export class AgentBridgeServer {
  readonly manifestPath: string;

  private readonly runtime: MutationApprovalRuntime;
  private readonly now: () => Date;
  private readonly tokenIssue;
  private readonly projectHash: string;
  private readonly submissionTimes: number[] = [];
  private server: http.Server | null = null;
  private manifest: AgentBridgeManifest | null = null;

  constructor(options: AgentBridgeServerOptions) {
    this.runtime = options.runtime;
    this.now = options.now ?? (() => new Date());
    this.tokenIssue = issueAppBridgeToken(365 * 24 * 60 * 60 * 1000, this.now());
    this.projectHash = hashAgentBridgeProjectBinding(this.runtime.projectRoot);
    this.manifestPath = path.join(
      path.resolve(options.userDataPath),
      AGENT_BRIDGE_MANIFEST_DIRECTORY,
      String(process.pid),
      AGENT_BRIDGE_MANIFEST_NAME,
    );
  }

  async start(): Promise<AgentBridgeManifest> {
    if (this.manifest) return { ...this.manifest };
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, AGENT_BRIDGE_HOST);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      await this.stop();
      throw new Error('Agent bridge did not bind a TCP port.');
    }
    const manifest: AgentBridgeManifest = {
      schemaVersion: AGENT_BRIDGE_SCHEMA_VERSION,
      host: AGENT_BRIDGE_HOST,
      port: address.port,
      token: this.tokenIssue.token,
      appSessionId: this.runtime.appSessionId,
      bridgeSessionId: this.runtime.bridgeSessionId,
      projectHash: this.projectHash,
      issuedAt: this.now().toISOString(),
    };
    try {
      writeManifest(this.manifestPath, manifest);
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.manifest = manifest;
    return { ...manifest };
  }

  isReady(): boolean {
    return Boolean(this.server?.listening && this.manifest);
  }

  async stop(): Promise<void> {
    this.removeOwnedManifest();
    this.manifest = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    applyResponseHeaders(response);
    if (!this.isAuthenticated(request)) {
      drainRequest(request);
      return writeJson(response, 401, bridgeError('unauthorized', 'Bridge authentication failed.'));
    }
    if (request.method === 'POST' && request.url === '/v1/patch-apply') {
      return this.handlePatchApply(request, response);
    }
    if (request.method === 'GET' && request.url === '/v1/status') {
      drainRequest(request);
      return writeJson(response, 200, { schemaVersion: 1, available: true, approvalRequired: true,
        operations: ['patch.apply', 'approval.status'], limits: { targetFileBytes: MUTATION_APPROVAL_LIMITS.targetFileBytes, operations: MUTATION_APPROVAL_LIMITS.operations, lineBytes: MUTATION_APPROVAL_LIMITS.lineBytes },
        execution: 'Extraction, provider translation and game-data apply run in the app UI.' });
    }
    if (request.method === 'GET' && request.url?.startsWith('/v1/approvals/')) {
      drainRequest(request);
      return this.handleApprovalStatus(request.url, response);
    }
    drainRequest(request);
    writeJson(response, 404, bridgeError('not-found', 'Bridge route was not found.'));
  }

  private async handlePatchApply(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      drainRequest(request);
      return writeJson(response, 415, bridgeError('unsupported-media-type', 'Use application/json.'));
    }
    if (!this.consumeSubmissionRate()) {
      drainRequest(request);
      return writeJson(response, 429, bridgeError(
        'rate-limit',
        `At most ${AGENT_BRIDGE_SUBMISSION_RATE} proposals may be submitted per minute.`,
      ));
    }
    let payload: unknown;
    try {
      payload = await readJsonBody(request);
    } catch (error) {
      const code = error instanceof AgentBridgeRequestError ? error.code : 'invalid-json';
      const status = code === 'body-too-large' ? 413 : 400;
      return writeJson(response, status, bridgeError(
        code,
        code === 'body-too-large'
          ? `Request exceeds ${AGENT_BRIDGE_BODY_LIMIT} bytes.`
          : 'Request body must be valid JSON.',
      ));
    }
    try {
      const approval = this.runtime.submit(payload, 'mcp');
      const bridgeApproval = this.runtime.getBridge({
        schemaVersion: 1,
        approvalId: approval.approvalId,
      });
      const result: AgentBridgePatchApplyResponse = {
        schemaVersion: 1,
        status: 'needs-approval',
        approval: bridgeApproval,
        polling: {
          toolName: 'approval.status',
          approvalId: bridgeApproval.approvalId,
        },
      };
      writeJson(response, 202, result);
    } catch (error) {
      this.writeRuntimeError(response, error);
    }
  }

  private handleApprovalStatus(url: string, response: http.ServerResponse): void {
    const approvalId = url.slice('/v1/approvals/'.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(approvalId)) {
      return writeJson(response, 400, bridgeError('invalid-request', 'Approval ID is invalid.'));
    }
    try {
      const approval = this.runtime.getBridge({ schemaVersion: 1, approvalId });
      const result: AgentBridgeApprovalStatusResponse = {
        schemaVersion: 1,
        status: approval.status,
        approval,
      };
      writeJson(response, 200, result);
    } catch (error) {
      this.writeRuntimeError(response, error);
    }
  }

  private isAuthenticated(request: http.IncomingMessage): boolean {
    const authorization = String(request.headers.authorization ?? '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    return validateAppBridgeToken(this.tokenIssue.record, token, this.now())
      && safeEqual(String(request.headers['x-llm-tsukuru-app-session'] ?? ''), this.runtime.appSessionId)
      && safeEqual(String(request.headers['x-llm-tsukuru-bridge-session'] ?? ''), this.runtime.bridgeSessionId)
      && safeEqual(String(request.headers['x-llm-tsukuru-project'] ?? ''), this.projectHash);
  }

  private consumeSubmissionRate(): boolean {
    const nowMs = this.now().getTime();
    while (this.submissionTimes.length > 0
      && this.submissionTimes[0] <= nowMs - AGENT_BRIDGE_RATE_WINDOW_MS) {
      this.submissionTimes.shift();
    }
    if (this.submissionTimes.length >= AGENT_BRIDGE_SUBMISSION_RATE) return false;
    this.submissionTimes.push(nowMs);
    return true;
  }

  private writeRuntimeError(response: http.ServerResponse, error: unknown): void {
    if (!(error instanceof MutationApprovalRuntimeError)) {
      return writeJson(response, 500, bridgeError(
        'internal-error',
        'The bridge could not safely process the request.',
      ));
    }
    const status = {
      'invalid-request': 400,
      'not-found': 404,
      'idempotency-conflict': 409,
      'pending-limit': 429,
      'history-limit': 429,
      'runtime-disposed': 410,
    }[error.code] ?? 409;
    writeJson(response, status, bridgeError(error.code, error.message));
  }

  private removeOwnedManifest(): void {
    try {
      if (!fs.existsSync(this.manifestPath)) return;
      const current = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8')) as Partial<AgentBridgeManifest>;
      if (current.token !== this.tokenIssue.token) return;
      fs.unlinkSync(this.manifestPath);
      fs.rmdirSync(path.dirname(this.manifestPath));
    } catch {
      // A stale or already-removed rendezvous file is safe to leave unavailable.
    }
  }
}

class AgentBridgeRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > AGENT_BRIDGE_BODY_LIMIT) {
        settled = true;
        reject(new AgentBridgeRequestError('body-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new AgentBridgeRequestError('invalid-json'));
      }
    });
    request.on('error', () => {
      if (settled) return;
      settled = true;
      reject(new AgentBridgeRequestError('invalid-json'));
    });
  });
}

function writeManifest(manifestPath: string, manifest: AgentBridgeManifest): void {
  const tempPath = `${manifestPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest), { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, manifestPath);
  try {
    fs.chmodSync(manifestPath, 0o600);
  } catch {
    // Windows ACLs remain the authority when POSIX mode bits are unavailable.
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf-8');
  const rightBytes = Buffer.from(right, 'utf-8');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function applyResponseHeaders(response: http.ServerResponse): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function writeJson(
  response: http.ServerResponse,
  statusCode: number,
  value: AgentBridgePatchApplyResponse | AgentBridgeApprovalStatusResponse | AgentBridgeErrorResponse | AgentBridgeStatusResponse,
): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = statusCode;
  response.end(JSON.stringify(value));
}

function bridgeError(code: string, message: string): AgentBridgeErrorResponse {
  return {
    schemaVersion: 1,
    error: { code, message },
  };
}

function drainRequest(request: http.IncomingMessage): void {
  request.resume();
}
