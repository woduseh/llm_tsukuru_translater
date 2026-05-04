import type * as NodePty from 'node-pty';
import type { TerminalEventKind } from '../types/agentWorkspace';

export interface PtySpawnOptions {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyExitEvent {
  exitCode: number;
  signal?: number;
}

export interface PtyProcess {
  pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (event: PtyExitEvent) => void): () => void;
}

export interface PtyAdapter {
  readonly kind: 'native' | 'fake' | 'unavailable';
  isAvailable(): boolean;
  getUnavailableReason(): string | undefined;
  spawn(options: PtySpawnOptions): PtyProcess;
}

export class NativePtyAdapter implements PtyAdapter {
  readonly kind = 'native' as const;
  private moduleLoadError: string | undefined;
  private nodePty: typeof NodePty | null = null;

  constructor() {
    try {
      // Lazy require keeps the app usable when the native module is absent in a packaged build.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.nodePty = require('node-pty') as typeof NodePty;
    } catch (error) {
      this.moduleLoadError = (error as Error).message || String(error);
    }
  }

  isAvailable(): boolean {
    return !!this.nodePty;
  }

  getUnavailableReason(): string | undefined {
    return this.moduleLoadError;
  }

  spawn(options: PtySpawnOptions): PtyProcess {
    if (!this.nodePty) {
      throw new Error(`Native PTY is unavailable: ${this.moduleLoadError || 'unknown error'}`);
    }
    const proc = this.nodePty.spawn(options.executable, options.args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
    });
    return {
      pid: proc.pid,
      write: (data) => proc.write(data),
      resize: (cols, rows) => proc.resize(cols, rows),
      kill: () => proc.kill(),
      onData: (callback) => {
        const disposable = proc.onData(callback);
        return () => disposable.dispose();
      },
      onExit: (callback) => {
        const disposable = proc.onExit((event) => callback({
          exitCode: event.exitCode,
          signal: event.signal,
        }));
        return () => disposable.dispose();
      },
    };
  }
}

export interface FakePtyScriptEvent {
  kind: Extract<TerminalEventKind, 'stdout' | 'stderr' | 'exit' | 'error'>;
  data?: string;
  exitCode?: number;
  delayMs?: number;
}

export interface FakePtyAdapterOptions {
  available?: boolean;
  unavailableReason?: string;
  script?: FakePtyScriptEvent[];
}

export class FakePtyAdapter implements PtyAdapter {
  readonly kind = 'fake' as const;
  private readonly available: boolean;
  private readonly unavailableReason: string | undefined;
  private readonly script: FakePtyScriptEvent[];

  constructor(options: FakePtyAdapterOptions = {}) {
    this.available = options.available ?? true;
    this.unavailableReason = options.unavailableReason;
    this.script = options.script ?? [{ kind: 'stdout', data: 'fake-pty-ready\r\n' }];
  }

  isAvailable(): boolean {
    return this.available;
  }

  getUnavailableReason(): string | undefined {
    return this.available ? undefined : (this.unavailableReason || 'Fake PTY unavailable');
  }

  lastSpawnOptions?: PtySpawnOptions;

  spawn(options: PtySpawnOptions): PtyProcess {
    if (!this.available) throw new Error(this.getUnavailableReason());
    this.lastSpawnOptions = options;
    return new FakePtyProcess(this.script);
  }
}

class FakePtyProcess implements PtyProcess {
  pid = undefined;
  private dataCallbacks: Array<(data: string) => void> = [];
  private exitCallbacks: Array<(event: PtyExitEvent) => void> = [];
  private killed = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(script: FakePtyScriptEvent[]) {
    let elapsed = 0;
    for (const event of script) {
      elapsed += event.delayMs ?? 0;
      const timer = setTimeout(() => {
        if (this.killed) return;
        if (event.kind === 'stdout' || event.kind === 'stderr' || event.kind === 'error') {
          this.dataCallbacks.forEach((callback) => callback(event.data ?? ''));
        } else if (event.kind === 'exit') {
          this.exitCallbacks.forEach((callback) => callback({ exitCode: event.exitCode ?? 0 }));
        }
      }, elapsed);
      this.timers.push(timer);
    }
  }

  write(data: string): void {
    if (this.killed) return;
    this.dataCallbacks.forEach((callback) => callback(data));
  }

  resize(cols: number, rows: number): void {
    if (this.killed) return;
    this.dataCallbacks.forEach((callback) => callback(`\r\n[fake-resize ${cols}x${rows}]\r\n`));
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.exitCallbacks.forEach((callback) => callback({ exitCode: 0 }));
  }

  onData(callback: (data: string) => void): () => void {
    this.dataCallbacks.push(callback);
    return () => {
      this.dataCallbacks = this.dataCallbacks.filter((candidate) => candidate !== callback);
    };
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitCallbacks.push(callback);
    return () => {
      this.exitCallbacks = this.exitCallbacks.filter((candidate) => candidate !== callback);
    };
  }
}
