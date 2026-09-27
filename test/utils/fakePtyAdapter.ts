import type { TerminalEventKind } from '../../src/types/agentWorkspace';
import type { PtyAdapter, PtyProcess, PtySpawnOptions, PtyExitEvent } from '../../src/agent/ptyAdapter';

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
