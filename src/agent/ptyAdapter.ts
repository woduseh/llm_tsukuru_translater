import type * as NodePty from 'node-pty';

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

