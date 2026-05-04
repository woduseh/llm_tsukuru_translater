import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import log from '../logger';
import type { AppContext } from '../appContext';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import {
  TerminalCapability,
  TerminalEvent,
  TerminalInputRequest,
  TerminalKillRequest,
  TerminalOperationResult,
  TerminalResizeRequest,
  TerminalSessionCreateRequest,
  TerminalSessionKind,
  TerminalSessionState,
  TerminalSessionSummary,
  TerminalSnapshot,
  TerminalSnapshotRequest,
} from '../types/agentWorkspace';
import { createTerminalCommandPreview, managedTerminalPresetForKind } from '../terminalCommandPresets';
import { redactSecretLikeValues } from './contractsValidation';
import { NativePtyAdapter, PtyAdapter, PtyProcess } from './ptyAdapter';

const MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
const MAX_RING_BUFFER_BYTES = 1024 * 1024;
const MAX_RING_BUFFER_EVENTS = 10000;
const MAX_INPUT_BYTES = 16 * 1024;
const LARGE_PASTE_CHARS = 2000;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const MAX_SESSIONS = 4;
const EARLY_EXIT_FAILURE_MS = 2000;

interface TerminalSessionInternal {
  sessionId: string;
  label: string;
  kind: TerminalSessionKind;
  state: TerminalSessionState;
  cwd: string;
  cwdLabel: string;
  ownerRoot: string;
  executable: string;
  executableLabel: string;
  args: string[];
  commandPreview: string;
  outputRetention: 'ephemeral' | 'persisted';
  persistOutput: boolean;
  bridgeAttached: boolean;
  redactionCount: number;
  truncationCount: number;
  latestSequence: number;
  exitCode?: number;
  process?: PtyProcess;
  events: TerminalEvent[];
  ringBufferBytes: number;
  disposers: Array<() => void>;
  createdAt: number;
  lastActivityAt: number;
}

export interface TerminalServiceOptions {
  ptyAdapter?: PtyAdapter;
  now?: () => Date;
}

export class TerminalService {
  private readonly ptyAdapter: PtyAdapter;
  private readonly sessions = new Map<string, TerminalSessionInternal>();
  private listeners: Array<(event: TerminalEvent) => void> = [];
  private sessionListeners: Array<(result: TerminalOperationResult) => void> = [];
  private readonly now: () => Date;

  constructor(private readonly ctx: AppContext, options: TerminalServiceOptions = {}) {
    this.ptyAdapter = options.ptyAdapter ?? new NativePtyAdapter();
    this.now = options.now ?? (() => new Date());
  }

  getCapability(): TerminalCapability {
    const nativePtyAvailable = this.ptyAdapter.isAvailable();
    if (!nativePtyAvailable) {
      return {
        schemaVersion: 1,
        status: 'degraded',
        nativePtyAvailable: false,
        reason: this.ptyAdapter.getUnavailableReason() || 'Native PTY module is not available.',
        fallbackHint: '내장 터미널을 사용할 수 없어 외부 터미널 안내로 대체됩니다.',
      };
    }
    if (this.ctx.terminalProjectRoots.length === 0) {
      return {
        schemaVersion: 1,
        status: 'degraded',
        nativePtyAvailable: true,
        reason: 'No trusted project folder has been selected.',
        fallbackHint: '먼저 프로젝트 폴더를 선택하세요.',
      };
    }
    return { schemaVersion: 1, status: 'enabled', nativePtyAvailable: true };
  }

  onEvent(listener: (event: TerminalEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  onSessions(listener: (result: TerminalOperationResult) => void): () => void {
    this.sessionListeners.push(listener);
    return () => {
      this.sessionListeners = this.sessionListeners.filter((candidate) => candidate !== listener);
    };
  }

  create(request: TerminalSessionCreateRequest): TerminalOperationResult {
    const validation = validateCreateRequest(request);
    if (validation) return failure(validation.errorCode, validation.message);
    const capability = this.getCapability();
    if (!this.ptyAdapter.isAvailable()) {
      return failure('terminal-unavailable', capability.reason || 'Native PTY is unavailable.', capability);
    }
    if (this.activeSessionCount() >= MAX_SESSIONS) {
      return failure('invalid-request', `터미널 세션은 최대 ${MAX_SESSIONS}개까지 실행할 수 있습니다.`, capability);
    }

    let resolved: ResolvedCommand;
    try {
      resolved = this.resolveCommand(request);
    } catch (error) {
      return failure((error as TerminalServiceError).code || 'invalid-request', (error as Error).message, capability);
    }

    const sessionId = `term-${crypto.randomBytes(8).toString('hex')}`;
    const session: TerminalSessionInternal = {
      sessionId,
      label: request.label || labelForKind(request.kind),
      kind: request.kind,
      state: 'starting',
      cwd: resolved.cwd,
      cwdLabel: resolved.cwd,
      ownerRoot: resolved.ownerRoot,
      executable: resolved.executable,
      executableLabel: resolved.executable,
      args: resolved.args,
      commandPreview: createTerminalCommandPreview(resolved.executable, resolved.args),
      outputRetention: request.persistOutput ? 'persisted' : 'ephemeral',
      persistOutput: request.persistOutput === true,
      bridgeAttached: false,
      redactionCount: 0,
      truncationCount: 0,
      latestSequence: 0,
      events: [],
      ringBufferBytes: 0,
      disposers: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.sessions.set(sessionId, session);

    try {
      const proc = this.ptyAdapter.spawn({
        executable: resolved.executable,
        args: resolved.args,
        cwd: resolved.cwd,
        env: buildSafeEnv(),
        cols: clampDimension(request.cols, DEFAULT_COLS, 20, 300),
        rows: clampDimension(request.rows, DEFAULT_ROWS, 8, 120),
      });
      session.process = proc;
      session.disposers.push(proc.onData((data) => this.handleData(session, data)));
      session.disposers.push(proc.onExit((event) => {
        session.exitCode = event.exitCode;
        const earlyFailure = session.state !== 'killed'
          && event.exitCode !== 0
          && Date.now() - session.createdAt <= EARLY_EXIT_FAILURE_MS;
        session.state = session.state === 'killed' ? 'killed' : earlyFailure ? 'failed' : 'exited';
        this.releaseProcessOwnership(session);
        if (earlyFailure) {
          this.recordEvent(session, {
            kind: 'error',
            errorCode: 'process-exited-early',
            data: earlyExitGuidance(session, event.exitCode),
          });
        }
        this.recordEvent(session, {
          kind: 'exit',
          exitCode: event.exitCode,
          data: `프로세스가 종료되었습니다. exitCode=${event.exitCode}`,
        });
        this.persistTranscriptIfNeeded(session);
        this.publishSessions();
      }));
      session.state = 'running';
      this.recordEvent(session, {
        kind: 'started',
        data: `${session.label} 세션이 시작되었습니다.`,
      });
      this.publishSessions();
      return success({ session: this.toSummary(session), capability: this.getCapability() });
    } catch (error) {
      session.state = 'failed';
      this.recordEvent(session, {
        kind: 'error',
        data: (error as Error).message || String(error),
        errorCode: 'pty-spawn-failed',
      });
      this.publishSessions();
      return failure('pty-spawn-failed', (error as Error).message || String(error), this.getCapability(), this.toSummary(session));
    }
  }

  input(request: TerminalInputRequest): TerminalOperationResult {
    const validation = validateInputRequest(request);
    if (validation) return failure(validation.errorCode, validation.message, this.getCapability());
    const session = this.sessions.get(request.sessionId);
    if (!session?.process) return failure('session-not-found', '터미널 세션을 찾을 수 없습니다.', this.getCapability());
    const byteLength = Buffer.byteLength(request.data, 'utf8');
    if (byteLength > MAX_INPUT_BYTES) {
      return failure('input-too-large', `터미널 입력은 ${MAX_INPUT_BYTES} bytes를 넘을 수 없습니다.`, this.getCapability(), this.toSummary(session));
    }
    const suspicious = request.data.includes('\n')
      || request.data.length > LARGE_PASTE_CHARS
      || containsSecretLikeValue(request.data);
    if ((request.paste || suspicious) && !request.confirmed) {
      return failure('paste-confirmation-required', '큰 붙여넣기, 여러 줄 입력, 또는 비밀값처럼 보이는 입력은 확인이 필요합니다.', this.getCapability(), this.toSummary(session));
    }
    session.process.write(request.data);
    session.lastActivityAt = Date.now();
    return success({ session: this.toSummary(session), capability: this.getCapability() });
  }

  resize(request: TerminalResizeRequest): TerminalOperationResult {
    if (!request || request.schemaVersion !== 1 || typeof request.sessionId !== 'string') {
      return failure('invalid-request', '터미널 크기 변경 요청이 올바르지 않습니다.', this.getCapability());
    }
    const session = this.sessions.get(request.sessionId);
    if (!session?.process) return failure('session-not-found', '터미널 세션을 찾을 수 없습니다.', this.getCapability());
    const cols = clampDimension(request.cols, DEFAULT_COLS, 20, 300);
    const rows = clampDimension(request.rows, DEFAULT_ROWS, 8, 120);
    session.process.resize(cols, rows);
    session.lastActivityAt = Date.now();
    return success({ session: this.toSummary(session), capability: this.getCapability() });
  }

  kill(request: TerminalKillRequest): TerminalOperationResult {
    if (!request || request.schemaVersion !== 1 || typeof request.sessionId !== 'string') {
      return failure('invalid-request', '터미널 종료 요청이 올바르지 않습니다.', this.getCapability());
    }
    const session = this.sessions.get(request.sessionId);
    if (!session) return failure('session-not-found', '터미널 세션을 찾을 수 없습니다.', this.getCapability());
    this.killSession(session);
    return success({ session: this.toSummary(session), capability: this.getCapability() });
  }

  list(): TerminalOperationResult {
    return success({
      sessions: Array.from(this.sessions.values()).map((session) => this.toSummary(session)),
      capability: this.getCapability(),
    });
  }

  snapshot(request: TerminalSnapshotRequest): TerminalOperationResult {
    if (!request || request.schemaVersion !== 1 || typeof request.sessionId !== 'string') {
      return failure('invalid-request', '터미널 스냅샷 요청이 올바르지 않습니다.', this.getCapability());
    }
    const session = this.sessions.get(request.sessionId);
    if (!session) return failure('session-not-found', '터미널 세션을 찾을 수 없습니다.', this.getCapability());
    const afterSequence = Number.isInteger(request.afterSequence) ? request.afterSequence ?? 0 : 0;
    const events = session.events.filter((event) => event.sequence > afterSequence);
    const snapshot: TerminalSnapshot = {
      schemaVersion: 1,
      session: this.toSummary(session),
      events,
      truncatedBeforeSequence: session.events[0]?.sequence,
    };
    return success({ snapshot, capability: this.getCapability() });
  }

  disposeAll(reason = 'disposeAll'): void {
    for (const session of this.sessions.values()) {
      this.killSession(session, reason);
    }
  }

  private resolveCommand(request: TerminalSessionCreateRequest): ResolvedCommand {
    const resolvedCwd = this.resolveCwd(request.cwd);
    const cwd = resolvedCwd.cwd;
    if (request.kind === 'custom') {
      if (!request.allowCustomCommand || !request.executable) {
        throw new TerminalServiceError('invalid-request', '사용자 지정 터미널은 명시적 확인과 실행 파일이 필요합니다.');
      }
      const executable = resolveExecutable(request.executable);
      return { executable, args: sanitizeArgs(request.args ?? []), cwd, ownerRoot: resolvedCwd.ownerRoot };
    }

    const preset = managedTerminalPresetForKind(request.kind);
    if (preset) {
      return {
        executable: findExecutable(preset.executableNames),
        args: sanitizeArgs(preset.args),
        cwd,
        ownerRoot: resolvedCwd.ownerRoot,
      };
    }
    const shell = findExecutable(process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe', 'cmd.exe'] : ['pwsh', 'bash', 'sh']);
    const args = path.basename(shell).toLowerCase().includes('powershell') || path.basename(shell).toLowerCase() === 'pwsh.exe'
      ? ['-NoLogo', '-NoProfile']
      : [];
    return { executable: shell, args, cwd, ownerRoot: resolvedCwd.ownerRoot };
  }

  private resolveCwd(candidate: string | undefined): { cwd: string; ownerRoot: string } {
    const rootPairs = this.ctx.terminalProjectRoots.map((root) => ({
      original: root,
      comparable: normalizeComparable(root),
    }));
    const roots = rootPairs.map((root) => root.comparable);
    if (roots.length === 0) {
      throw new TerminalServiceError('no-trusted-project', '먼저 프로젝트 폴더를 선택해야 내장 터미널을 시작할 수 있습니다.');
    }
    const requested = candidate ? path.resolve(candidate) : (this.ctx.currentTerminalProjectRoot || this.ctx.terminalProjectRoots[this.ctx.terminalProjectRoots.length - 1]);
    if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) {
      throw new TerminalServiceError('cwd-denied', '터미널 작업 폴더가 존재하지 않습니다.');
    }
    const canonical = fs.realpathSync.native(requested);
    const normalized = normalizeComparable(canonical);
    const ownerRoot = rootPairs.find((root) => normalized === root.comparable || normalized.startsWith(`${root.comparable}${path.sep}`));
    if (!ownerRoot) {
      throw new TerminalServiceError('cwd-denied', '선택한 프로젝트 폴더 밖에서는 터미널을 시작할 수 없습니다.');
    }
    return { cwd: canonical, ownerRoot: ownerRoot.original };
  }

  private handleData(session: TerminalSessionInternal, data: string): void {
    const rawBytes = Buffer.byteLength(data, 'utf8');
    let omittedBytes = 0;
    let bounded = data;
    if (rawBytes > MAX_OUTPUT_CHUNK_BYTES) {
      const buffer = Buffer.from(data, 'utf8');
      bounded = buffer.subarray(0, MAX_OUTPUT_CHUNK_BYTES).toString('utf8');
      omittedBytes = rawBytes - MAX_OUTPUT_CHUNK_BYTES;
    }
    const redacted = redactTerminalText(stripUnsafeTerminalSequences(bounded), knownSecretsFromSettings(this.ctx));
    session.redactionCount += redacted.redactions.length;
    if (omittedBytes > 0) session.truncationCount += 1;
    this.recordEvent(session, {
      kind: omittedBytes > 0 ? 'truncated' : 'stdout',
      data: redacted.text,
      omittedBytes,
    });
  }

  private recordEvent(
    session: TerminalSessionInternal,
    event: Omit<TerminalEvent, 'schemaVersion' | 'sessionId' | 'sequence' | 'timestamp' | 'redacted'>,
  ): TerminalEvent {
    const terminalEvent: TerminalEvent = {
      schemaVersion: 1,
      sessionId: session.sessionId,
      sequence: ++session.latestSequence,
      timestamp: this.now().toISOString(),
      redacted: true,
      ...event,
    };
    session.events.push(terminalEvent);
    session.ringBufferBytes += Buffer.byteLength(terminalEvent.data ?? '', 'utf8');
    while (
      session.events.length > MAX_RING_BUFFER_EVENTS
      || session.ringBufferBytes > MAX_RING_BUFFER_BYTES
    ) {
      const removed = session.events.shift();
      if (!removed) break;
      session.ringBufferBytes -= Buffer.byteLength(removed.data ?? '', 'utf8');
    }
    session.lastActivityAt = Date.now();
    this.listeners.forEach((listener) => listener(terminalEvent));
    return terminalEvent;
  }

  private killSession(session: TerminalSessionInternal, reason = 'user-kill'): void {
    if (!session.process && ['exited', 'failed', 'killed'].includes(session.state)) {
      return;
    }
    session.state = 'killed';
    for (const dispose of session.disposers.splice(0)) dispose();
    const pid = session.process?.pid;
    try {
      session.process?.kill();
    } catch (error) {
      log.warn('Failed to kill PTY process directly.', error);
    }
    this.releaseProcessOwnership(session);
    if (typeof pid === 'number') {
      killProcessTree(pid);
    }
    this.recordEvent(session, {
      kind: 'exit',
      exitCode: session.exitCode ?? 0,
      data: `터미널 세션이 종료되었습니다. reason=${reason}`,
    });
    this.persistTranscriptIfNeeded(session);
    this.publishSessions();
  }

  private releaseProcessOwnership(session: TerminalSessionInternal): void {
    for (const dispose of session.disposers.splice(0)) dispose();
    session.process = undefined;
  }

  private persistTranscriptIfNeeded(session: TerminalSessionInternal): void {
    if (!session.persistOutput) return;
    const root = session.ownerRoot;
    if (!root) return;
    const transcriptPath = path.join(root, '.llm-tsukuru-agent', 'terminal-sessions', `${session.sessionId}.json`);
    const payload = {
      schemaVersion: 1,
      session: this.toSummary(session),
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.lastActivityAt).toISOString(),
      events: session.events,
      retention: {
        redactedOnly: true,
        inputPersisted: false,
        maxBytes: MAX_RING_BUFFER_BYTES,
      },
    };
    try {
      fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
      atomicWriteJsonFile(transcriptPath, payload, 2);
    } catch (error) {
      log.warn('Failed to persist terminal transcript.', error);
    }
  }

  private publishSessions(): void {
    const result = this.list();
    this.sessionListeners.forEach((listener) => listener(result));
  }

  private activeSessionCount(): number {
    return Array.from(this.sessions.values())
      .filter((session) => ['starting', 'running', 'idle', 'reconnecting'].includes(session.state))
      .length;
  }

  private toSummary(session: TerminalSessionInternal): TerminalSessionSummary {
    return {
      schemaVersion: 1,
      sessionId: session.sessionId,
      label: session.label,
      kind: session.kind,
      state: session.state,
      cwdLabel: session.cwdLabel,
      outputRetention: session.outputRetention,
      persistOutput: session.persistOutput,
      exitCode: session.exitCode,
      executableLabel: session.executableLabel,
      commandPreview: session.commandPreview,
      latestSequence: session.latestSequence,
      bridgeAttached: session.bridgeAttached,
      redactionCount: session.redactionCount,
      truncationCount: session.truncationCount,
    };
  }
}

interface ResolvedCommand {
  executable: string;
  args: string[];
  cwd: string;
  ownerRoot: string;
}

class TerminalServiceError extends Error {
  constructor(readonly code: TerminalOperationResult['errorCode'], message: string) {
    super(message);
  }
}

function success(partial: Omit<TerminalOperationResult, 'schemaVersion' | 'ok'> = {}): TerminalOperationResult {
  return { schemaVersion: 1, ok: true, ...partial };
}

function failure(
  errorCode: NonNullable<TerminalOperationResult['errorCode']>,
  message: string,
  capability?: TerminalCapability,
  session?: TerminalSessionSummary,
): TerminalOperationResult {
  return { schemaVersion: 1, ok: false, errorCode, message, capability, session };
}

function validateCreateRequest(request: TerminalSessionCreateRequest): { errorCode: NonNullable<TerminalOperationResult['errorCode']>; message: string } | null {
  if (!request || request.schemaVersion !== 1) return { errorCode: 'invalid-request', message: '터미널 생성 요청이 올바르지 않습니다.' };
  if (!['codex', 'claude', 'shell', 'custom'].includes(request.kind)) return { errorCode: 'invalid-request', message: '지원하지 않는 터미널 종류입니다.' };
  if (request.args && (!Array.isArray(request.args) || request.args.some((arg) => typeof arg !== 'string'))) {
    return { errorCode: 'invalid-request', message: '터미널 인자는 문자열 배열이어야 합니다.' };
  }
  return null;
}

function validateInputRequest(request: TerminalInputRequest): { errorCode: NonNullable<TerminalOperationResult['errorCode']>; message: string } | null {
  if (!request || request.schemaVersion !== 1 || typeof request.sessionId !== 'string' || typeof request.data !== 'string') {
    return { errorCode: 'invalid-request', message: '터미널 입력 요청이 올바르지 않습니다.' };
  }
  return null;
}

function labelForKind(kind: TerminalSessionKind): string {
  if (kind === 'codex') return 'Codex';
  if (kind === 'claude') return 'Claude';
  if (kind === 'custom') return 'Custom';
  return 'PowerShell';
}

function earlyExitGuidance(session: TerminalSessionInternal, exitCode: number): string {
  const output = session.events.map((event) => event.data ?? '').join('\n');
  const cwdHint = `작업 폴더: ${session.cwdLabel}`;
  const commandHint = `실행 명령: ${session.commandPreview}`;
  if (session.kind === 'codex' && /unexpected argument ['"]?--cwd/i.test(output)) {
    return [
      'Codex CLI가 지원하지 않는 --cwd 인자를 거부했습니다.',
      '앱은 이제 --cwd를 넘기지 않고 터미널 작업 폴더(cwd)로 프로젝트를 지정합니다.',
      cwdHint,
      commandHint,
      '다시 시작하거나 PowerShell 세션에서 codex --version을 확인하세요.',
    ].join('\n');
  }
  if (session.kind === 'codex' && /config\.toml[\s\S]*features[\s\S]*expected a boolean|invalid type:\s*string[\s\S]*expected a boolean[\s\S]*features/i.test(output)) {
    return [
      'Codex 사용자 설정(config.toml)의 features 값이 문자열이라 Codex가 시작되지 못했습니다.',
      '앱은 기본 실행에 -c features={} 호환 옵션을 적용하지만, 기존 세션 출력이라면 다시 시작해 보세요.',
      '계속 실패하면 ~/.codex/config.toml의 [features] 항목에서 "true", "false", URL 같은 문자열 값을 true/false boolean 값으로 고쳐야 합니다.',
      cwdHint,
      commandHint,
    ].join('\n');
  }
  if (session.kind === 'codex') {
    return [
      `Codex CLI가 시작 직후 종료되었습니다. exitCode=${exitCode}`,
      cwdHint,
      commandHint,
      'Codex 설치 상태와 codex --version 결과를 확인하거나 PowerShell 세션으로 프로젝트 폴더에서 직접 실행해 보세요.',
    ].join('\n');
  }
  if (session.kind === 'claude') {
    return [
      `Claude CLI가 시작 직후 종료되었습니다. exitCode=${exitCode}`,
      cwdHint,
      commandHint,
      'Claude CLI 설치 상태와 claude --version 결과를 확인하거나 PowerShell 세션으로 프로젝트 폴더에서 직접 실행해 보세요.',
    ].join('\n');
  }
  return [
    `터미널 프로세스가 시작 직후 종료되었습니다. exitCode=${exitCode}`,
    cwdHint,
    commandHint,
  ].join('\n');
}

function clampDimension(value: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}

function normalizeComparable(candidatePath: string): string {
  return path.resolve(candidatePath).toLowerCase();
}

function sanitizeArgs(args: string[]): string[] {
  return args.map((arg) => String(arg));
}

function resolveExecutable(executable: string): string {
  if (executable.includes('\0')) throw new TerminalServiceError('invalid-request', '실행 파일 경로가 올바르지 않습니다.');
  if (path.isAbsolute(executable)) {
    const canonical = fs.realpathSync.native(executable);
    if (!fs.statSync(canonical).isFile()) throw new TerminalServiceError('executable-missing', '실행 파일을 찾을 수 없습니다.');
    return canonical;
  }
  return findExecutable([executable]);
}

function findExecutable(names: string[]): string {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    if (path.isAbsolute(name) && fs.existsSync(name)) return fs.realpathSync.native(name);
    for (const entry of pathEntries) {
      const candidate = path.join(entry, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return fs.realpathSync.native(candidate);
      }
    }
  }
  throw new TerminalServiceError('executable-missing', `실행 파일을 찾을 수 없습니다: ${names.join(', ')}`);
}

function buildSafeEnv(): Record<string, string> {
  const allowed = ['SystemRoot', 'ComSpec', 'PATH', 'Path', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'LANG', 'LC_ALL', 'TERM'];
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (typeof value === 'string' && value) env[key] = value;
  }
  env.TERM = env.TERM || 'xterm-256color';
  env.LLM_TSUKURU_TERMINAL = '1';
  return env;
}

function knownSecretsFromSettings(ctx: AppContext): string[] {
  return [
    ctx.settings.llmApiKey,
    ctx.settings.llmOpenAiApiKey,
    ctx.settings.llmClaudeApiKey,
    ctx.settings.llmCustomApiKey,
    ctx.settings.llmVertexServiceAccountJson,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function redactTerminalText(text: string, exactSecrets: string[] = []): { text: string; redactions: string[] } {
  let value = text;
  const redactions: string[] = [];
  for (const secret of exactSecrets) {
    if (!secret) continue;
    if (value.includes(secret)) {
      value = value.split(secret).join('[REDACTED]');
      redactions.push('exact-secret');
    }
  }
  const redacted = redactSecretLikeValues({ text: value });
  return { text: String(redacted.value.text ?? ''), redactions: [...redactions, ...redacted.redactions] };
}

function containsSecretLikeValue(text: string): boolean {
  return redactTerminalText(text).text !== text;
}

function stripUnsafeTerminalSequences(value: string): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[?=]?[0-9;]*[A-Za-z]/g, '');
}

function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform !== 'win32') {
    try { process.kill(pid); } catch { /* already exited */ }
    return;
  }
  const ps = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    '$all = New-Object System.Collections.Generic.List[int]; '
      + 'function Add-Children([int]$Parent) { '
      + '$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $Parent"; '
      + 'foreach ($child in $children) { $all.Add([int]$child.ProcessId); Add-Children ([int]$child.ProcessId) } '
      + '} '
      + `Add-Children ${pid}; `
      + '$ids = $all.ToArray(); [array]::Reverse($ids); '
      + '$ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; '
      + `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
  ];
  const child = spawn('powershell.exe', ps, {
    windowsHide: true,
    detached: false,
    stdio: 'ignore',
    env: {
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      PATH: process.env.PATH || '',
      TEMP: process.env.TEMP || os.tmpdir(),
      TMP: process.env.TMP || os.tmpdir(),
    },
  });
  child.on('error', (error) => log.warn('Failed to run process tree cleanup.', error));
}
