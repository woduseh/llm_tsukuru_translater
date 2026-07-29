import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {
  AGENT_BRIDGE_BODY_LIMIT,
  hashAgentBridgeProjectBinding,
  isAgentBridgeManifest,
  type AgentBridgeApprovalStatusResponse,
  type AgentBridgeErrorResponse,
  type AgentBridgeManifest,
  type AgentBridgePatchApplyRequest,
  type AgentBridgePatchApplyResponse,
} from '../agent/agentBridgeContracts';

const MANIFEST_LIMIT = 8 * 1024;
const RESPONSE_LIMIT = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export class AgentBridgeClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentBridgeClientError';
  }
}

export class AgentBridgeClient {
  private constructor(private readonly manifest: AgentBridgeManifest) {}

  static fromManifest(manifestPath: string, projectRoot: string): AgentBridgeClient {
    const resolvedPath = path.resolve(manifestPath);
    let stat: fs.Stats;
    let value: unknown;
    try {
      stat = fs.statSync(resolvedPath);
      if (!stat.isFile() || stat.size < 1 || stat.size > MANIFEST_LIMIT) {
        throw new AgentBridgeClientError('bridge-unavailable', 'The bridge manifest is unavailable.');
      }
      value = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    } catch (error) {
      if (error instanceof AgentBridgeClientError) throw error;
      throw new AgentBridgeClientError('bridge-unavailable', 'The running app bridge was not found.');
    }
    if (!isAgentBridgeManifest(value)) {
      throw new AgentBridgeClientError('invalid-manifest', 'The bridge manifest is invalid.');
    }
    if (value.projectHash !== hashAgentBridgeProjectBinding(projectRoot)) {
      throw new AgentBridgeClientError(
        'project-mismatch',
        'The bridge belongs to a different selected project.',
      );
    }
    return new AgentBridgeClient(value);
  }

  submit(request: AgentBridgePatchApplyRequest): Promise<AgentBridgePatchApplyResponse> {
    return this.request('POST', '/v1/patch-apply', request) as Promise<AgentBridgePatchApplyResponse>;
  }

  getApproval(approvalId: string): Promise<AgentBridgeApprovalStatusResponse> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(approvalId)) {
      return Promise.reject(new AgentBridgeClientError('invalid-request', 'approval.status requires a valid approvalId.'));
    }
    return this.request('GET', `/v1/approvals/${approvalId}`) as Promise<AgentBridgeApprovalStatusResponse>;
  }

  private request(
    method: 'GET' | 'POST',
    requestPath: string,
    body?: AgentBridgePatchApplyRequest,
  ): Promise<AgentBridgePatchApplyResponse | AgentBridgeApprovalStatusResponse> {
    const serialized = body ? JSON.stringify(body) : undefined;
    if (serialized && Buffer.byteLength(serialized, 'utf-8') > AGENT_BRIDGE_BODY_LIMIT) {
      return Promise.reject(new AgentBridgeClientError(
        'body-too-large',
        `Request exceeds ${AGENT_BRIDGE_BODY_LIMIT} bytes.`,
      ));
    }
    return new Promise((resolve, reject) => {
      const request = http.request({
        host: this.manifest.host,
        port: this.manifest.port,
        path: requestPath,
        method,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${this.manifest.token}`,
          'X-LLM-Tsukuru-App-Session': this.manifest.appSessionId,
          'X-LLM-Tsukuru-Bridge-Session': this.manifest.bridgeSessionId,
          'X-LLM-Tsukuru-Project': this.manifest.projectHash,
          Accept: 'application/json',
          ...(serialized ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(serialized, 'utf-8'),
          } : {}),
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > RESPONSE_LIMIT) {
            response.destroy(new AgentBridgeClientError(
              'response-too-large',
              'The bridge response exceeded its safe limit.',
            ));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          let payload: unknown;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            reject(new AgentBridgeClientError('invalid-response', 'The bridge returned invalid JSON.'));
            return;
          }
          const statusCode = response.statusCode ?? 500;
          if (statusCode < 200 || statusCode >= 300) {
            const errorPayload = payload as Partial<AgentBridgeErrorResponse>;
            reject(new AgentBridgeClientError(
              errorPayload.error?.code || 'bridge-error',
              errorPayload.error?.message || 'The bridge rejected the request.',
            ));
            return;
          }
          resolve(payload as AgentBridgePatchApplyResponse | AgentBridgeApprovalStatusResponse);
        });
        response.on('error', (error) => reject(toClientError(error)));
      });
      request.on('timeout', () => {
        request.destroy(new AgentBridgeClientError('bridge-timeout', 'The running app bridge did not respond.'));
      });
      request.on('error', (error) => reject(toClientError(error)));
      if (serialized) request.write(serialized);
      request.end();
    });
  }
}

function toClientError(error: Error): AgentBridgeClientError {
  return error instanceof AgentBridgeClientError
    ? error
    : new AgentBridgeClientError('bridge-unavailable', 'The running app bridge is unavailable.');
}
