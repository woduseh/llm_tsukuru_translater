import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AppContext } from '../../src/appContext';
import { FakePtyAdapter, TerminalService, redactTerminalText } from '../../src/agent';

const tmpRoot = path.join(process.cwd(), 'test', '.tmp-terminal-service');

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('TerminalService', () => {
  it('fails closed when no trusted project root has been selected', () => {
    const ctx = new AppContext();
    const service = new TerminalService(ctx, { ptyAdapter: new FakePtyAdapter() });

    const result = service.create({
      schemaVersion: 1,
      requestId: 'req-no-project',
      kind: 'shell',
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('no-trusted-project');
  });

  it('creates fake PTY sessions, streams bounded redacted events, snapshots, resizes, and kills', async () => {
    const projectRoot = makeProject('fixture');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [projectRoot];
    ctx.settings.llmApiKey = 'secret-terminal-key';
    const service = new TerminalService(ctx, {
      ptyAdapter: new FakePtyAdapter({
        script: [
          { kind: 'stdout', data: 'hello token=secret-terminal-key\r\n' },
          { kind: 'stdout', data: 'x'.repeat(80 * 1024) },
        ],
      }),
    });
    const events = [] as string[];
    service.onEvent((event) => {
      if (event.data) events.push(event.data);
    });

    const created = service.create({
      schemaVersion: 1,
      requestId: 'req-create',
      kind: 'shell',
      cwd: projectRoot,
      cols: 80,
      rows: 24,
    });
    await delay(20);

    expect(created.ok).toBe(true);
    expect(created.session?.state).toBe('running');
    expect(events.join('\n')).not.toContain('secret-terminal-key');
    expect(events.join('\n')).toContain('[REDACTED]');

    const sessionId = created.session!.sessionId;
    const resize = service.resize({ schemaVersion: 1, sessionId, cols: 120, rows: 30 });
    expect(resize.ok).toBe(true);

    const snapshot = service.snapshot({ schemaVersion: 1, sessionId });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.snapshot?.events.some((event) => event.kind === 'truncated')).toBe(true);
    expect(snapshot.snapshot?.session.truncationCount).toBeGreaterThan(0);

    const killed = service.kill({ schemaVersion: 1, sessionId });
    expect(killed.ok).toBe(true);
    expect(killed.session?.state).toBe('killed');
  });

  it('requires confirmation for large, multiline, or secret-like paste input', () => {
    const projectRoot = makeProject('paste');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [projectRoot];
    const service = new TerminalService(ctx, { ptyAdapter: new FakePtyAdapter() });
    const created = service.create({
      schemaVersion: 1,
      requestId: 'req-paste',
      kind: 'shell',
      cwd: projectRoot,
    });
    const sessionId = created.session!.sessionId;

    const blocked = service.input({
      schemaVersion: 1,
      sessionId,
      data: 'line 1\nline 2 token=secret-value',
      paste: true,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errorCode).toBe('paste-confirmation-required');

    const confirmed = service.input({
      schemaVersion: 1,
      sessionId,
      data: 'line 1\nline 2 token=secret-value',
      paste: true,
      confirmed: true,
    });
    expect(confirmed.ok).toBe(true);
  });

  it('rejects cwd escapes even when the directory exists', () => {
    const projectRoot = makeProject('safe-root');
    const outside = makeProject('outside-root');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [projectRoot];
    const service = new TerminalService(ctx, { ptyAdapter: new FakePtyAdapter() });

    const result = service.create({
      schemaVersion: 1,
      requestId: 'req-escape',
      kind: 'shell',
      cwd: outside,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('cwd-denied');
  });

  it('does not count killed sessions against the active session limit', () => {
    const projectRoot = makeProject('session-limit');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [projectRoot];
    const service = new TerminalService(ctx, { ptyAdapter: new FakePtyAdapter() });

    for (let i = 0; i < 6; i += 1) {
      const created = service.create({
        schemaVersion: 1,
        requestId: `req-limit-${i}`,
        kind: 'shell',
        cwd: projectRoot,
      });
      expect(created.ok).toBe(true);
      const killed = service.kill({ schemaVersion: 1, sessionId: created.session!.sessionId });
      expect(killed.ok).toBe(true);
    }
  });

  it('defaults new sessions to the current selected terminal root', () => {
    const firstRoot = makeProject('first-default');
    const secondRoot = makeProject('second-default');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [firstRoot, secondRoot];
    ctx.currentTerminalProjectRoot = secondRoot;
    const service = new TerminalService(ctx, { ptyAdapter: new FakePtyAdapter() });

    const created = service.create({
      schemaVersion: 1,
      requestId: 'req-current-root',
      kind: 'shell',
    });

    expect(created.ok).toBe(true);
    expect(created.session?.cwdLabel).toBe(secondRoot);
  });

  it('launches Codex in the trusted cwd without adding unsupported --cwd args', () => {
    const projectRoot = makeProject('codex-cwd');
    const originalPath = process.env.PATH;
    const binDir = makeExecutableDir('codex-bin', ['codex.cmd', 'codex.exe', 'codex']);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    try {
      const ctx = new AppContext();
      ctx.terminalProjectRoots = [projectRoot];
      const adapter = new FakePtyAdapter();
      const service = new TerminalService(ctx, { ptyAdapter: adapter });

      const created = service.create({
        schemaVersion: 1,
        requestId: 'req-codex-cwd',
        kind: 'codex',
        cwd: projectRoot,
      });

      expect(created.ok).toBe(true);
      expect(adapter.lastSpawnOptions?.cwd).toBe(projectRoot);
      expect(adapter.lastSpawnOptions?.args).toEqual(['-c', 'features={}']);
      expect(created.session?.commandPreview).not.toContain('--cwd');
      expect(created.session?.commandPreview).toContain('features={}');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('marks early non-zero Codex exits as failed with actionable guidance', async () => {
    const projectRoot = makeProject('codex-early-exit');
    const originalPath = process.env.PATH;
    const binDir = makeExecutableDir('codex-fail-bin', ['codex.cmd', 'codex.exe', 'codex']);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    try {
      const ctx = new AppContext();
      ctx.terminalProjectRoots = [projectRoot];
      const service = new TerminalService(ctx, {
        ptyAdapter: new FakePtyAdapter({
          script: [
            { kind: 'stdout', data: "error: unexpected argument '--cwd' found\r\n" },
            { kind: 'exit', exitCode: 2 },
          ],
        }),
      });

      const created = service.create({
        schemaVersion: 1,
        requestId: 'req-codex-early-exit',
        kind: 'codex',
        cwd: projectRoot,
      });
      await delay(20);

      const snapshot = service.snapshot({ schemaVersion: 1, sessionId: created.session!.sessionId });
      expect(snapshot.snapshot?.session.state).toBe('failed');
      expect(snapshot.snapshot?.events.some((event) => event.kind === 'error' && event.errorCode === 'process-exited-early')).toBe(true);
      expect(snapshot.snapshot?.events.map((event) => event.data).join('\n')).toContain('Codex CLI가 지원하지 않는 --cwd');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('explains Codex config.toml features type errors instead of generic install guidance', async () => {
    const projectRoot = makeProject('codex-config-error');
    const originalPath = process.env.PATH;
    const binDir = makeExecutableDir('codex-config-bin', ['codex.cmd', 'codex.exe', 'codex']);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    try {
      const ctx = new AppContext();
      ctx.terminalProjectRoots = [projectRoot];
      const service = new TerminalService(ctx, {
        ptyAdapter: new FakePtyAdapter({
          script: [
            { kind: 'stdout', data: 'Error loading config.toml: invalid type: string "http://localhost:39464/mcp", expected a boolean\r\nin `features`\r\n' },
            { kind: 'exit', exitCode: 1 },
          ],
        }),
      });

      const created = service.create({
        schemaVersion: 1,
        requestId: 'req-codex-config-error',
        kind: 'codex',
        cwd: projectRoot,
      });
      await delay(20);

      const snapshot = service.snapshot({ schemaVersion: 1, sessionId: created.session!.sessionId });
      const output = snapshot.snapshot?.events.map((event) => event.data).join('\n') ?? '';
      expect(snapshot.snapshot?.session.state).toBe('failed');
      expect(output).toContain('Codex 사용자 설정(config.toml)의 features 값');
      expect(output).toContain('-c features={}');
      expect(output).not.toContain('Codex 설치 상태');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('persists only redacted terminal transcripts when explicitly enabled', async () => {
    const projectRoot = makeProject('persisted');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [projectRoot];
    ctx.settings.llmApiKey = 'persist-secret';
    const service = new TerminalService(ctx, {
      ptyAdapter: new FakePtyAdapter({
        script: [{ kind: 'stdout', data: 'token=persist-secret' }],
      }),
    });

    const created = service.create({
      schemaVersion: 1,
      requestId: 'req-persist',
      kind: 'shell',
      cwd: projectRoot,
      persistOutput: true,
    });
    await delay(20);
    service.kill({ schemaVersion: 1, sessionId: created.session!.sessionId });

    const transcriptPath = path.join(projectRoot, '.llm-tsukuru-agent', 'terminal-sessions', `${created.session!.sessionId}.json`);
    const transcript = fs.readFileSync(transcriptPath, 'utf8');
    expect(transcript).not.toContain('persist-secret');
    expect(transcript).toContain('[REDACTED]');
  });

  it('persists transcripts to the session owner root even if context roots change before kill', async () => {
    const firstRoot = makeProject('first-owner');
    const secondRoot = makeProject('second-owner');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [firstRoot];
    const service = new TerminalService(ctx, { ptyAdapter: new FakePtyAdapter() });
    const created = service.create({
      schemaVersion: 1,
      requestId: 'req-owner-root',
      kind: 'shell',
      cwd: firstRoot,
      persistOutput: true,
    });
    await delay(20);

    ctx.terminalProjectRoots = [secondRoot];
    service.kill({ schemaVersion: 1, sessionId: created.session!.sessionId });

    const firstTranscript = path.join(firstRoot, '.llm-tsukuru-agent', 'terminal-sessions', `${created.session!.sessionId}.json`);
    const secondTranscript = path.join(secondRoot, '.llm-tsukuru-agent', 'terminal-sessions', `${created.session!.sessionId}.json`);
    expect(fs.existsSync(firstTranscript)).toBe(true);
    expect(fs.existsSync(secondTranscript)).toBe(false);
  });

  it('does not retain process ownership after natural exit', async () => {
    const projectRoot = makeProject('natural-exit');
    const ctx = new AppContext();
    ctx.terminalProjectRoots = [projectRoot];
    const service = new TerminalService(ctx, {
      ptyAdapter: new FakePtyAdapter({ script: [{ kind: 'exit', exitCode: 0 }] }),
    });
    const created = service.create({
      schemaVersion: 1,
      requestId: 'req-natural-exit',
      kind: 'shell',
      cwd: projectRoot,
    });
    await delay(20);

    const killed = service.kill({ schemaVersion: 1, sessionId: created.session!.sessionId });
    expect(killed.ok).toBe(true);
    expect(killed.session?.state).toBe('exited');
  });

  it('redacts exact known secrets before terminal output is stored', () => {
    const result = redactTerminalText('Bearer abc and exact-secret-value', ['exact-secret-value']);

    expect(result.text).not.toContain('exact-secret-value');
    expect(result.text).not.toContain('Bearer abc');
    expect(result.redactions.length).toBeGreaterThan(0);
  });
});

function makeProject(name: string): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync.native(dir);
}

function makeExecutableDir(name: string, executableNames: string[]): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const executableName of executableNames) {
    fs.writeFileSync(path.join(dir, executableName), '', 'utf8');
  }
  return fs.realpathSync.native(dir);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
