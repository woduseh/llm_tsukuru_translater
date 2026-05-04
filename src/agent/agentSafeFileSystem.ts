import * as fs from 'fs';
import * as path from 'path';
import { redactSecretLikeValues } from './contractsValidation';
import { SandboxPathError, SandboxReadLimitError } from './sandboxManager';

export interface SafeReadOptions {
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

export interface SafeTextReadResult {
  absolutePath: string;
  relativePath: string;
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  redactions: string[];
}

export interface AgentSafeFileSystemOptions {
  projectRoot: string;
  allowedRoots?: string[];
  maxReadBytes?: number;
  redact?: (text: string) => { text: string; redactions: string[] };
}

export class AgentSafeFileSystem {
  readonly projectRoot: string;
  readonly allowedRoots: string[];
  readonly maxReadBytes: number;

  constructor(private readonly options: AgentSafeFileSystemOptions) {
    this.projectRoot = normalizeRoot(options.projectRoot);
    this.allowedRoots = (options.allowedRoots?.length ? options.allowedRoots : [this.projectRoot]).map(normalizeRoot);
    this.maxReadBytes = options.maxReadBytes ?? 64 * 1024;
  }

  resolveAllowed(candidatePath: string): string {
    if (isUncPath(candidatePath)) {
      throw new SandboxPathError(`UNC paths are not allowed: ${candidatePath}`);
    }
    if (hasWindowsAlternateDataStream(candidatePath)) {
      throw new SandboxPathError(`ADS paths are not allowed: ${candidatePath}`);
    }
    const resolved = path.resolve(this.projectRoot, candidatePath);
    const existingProbe = nearestExistingPath(resolved);
    const canonical = fs.existsSync(resolved) ? realpath(resolved) : path.resolve(realpath(existingProbe), path.relative(existingProbe, resolved));
    const normalized = normalizePath(canonical);
    if (!this.allowedRoots.some((root) => isPathInsideRoot(normalized, root))) {
      throw new SandboxPathError(`Path escapes allowed roots: ${candidatePath}`);
    }
    return canonical;
  }

  readText(candidatePath: string, options: SafeReadOptions = {}): SafeTextReadResult {
    const absolutePath = this.resolveAllowed(candidatePath);
    const maxBytes = Math.max(1, options.maxBytes ?? this.maxReadBytes);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new SandboxPathError(`Not a file: ${candidatePath}`);
    }
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const fd = fs.openSync(absolutePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const truncated = stat.size > maxBytes;
    if (truncated && buffer.length === 0) {
      throw new SandboxReadLimitError(`Read exceeds ${maxBytes} bytes: ${candidatePath}`);
    }
    const decoded = stripBom(buffer.toString('utf-8'));
    const lines = decoded.split(/\r?\n/);
    const startLine = Math.max(1, options.startLine ?? 1);
    const requestedEnd = options.endLine ?? lines.length;
    const endLine = Math.max(startLine, Math.min(requestedEnd, lines.length));
    const selected = lines.slice(startLine - 1, endLine).join('\n');
    const redacted = this.options.redact ? this.options.redact(selected) : redactText(selected);
    return {
      absolutePath,
      relativePath: path.relative(this.projectRoot, absolutePath),
      text: redacted.text,
      startLine,
      endLine,
      truncated,
      redactions: redacted.redactions,
    };
  }
}

function redactText(text: string): { text: string; redactions: string[] } {
  const redacted = redactSecretLikeValues({ text });
  return { text: String(redacted.value.text ?? ''), redactions: redacted.redactions };
}

function nearestExistingPath(candidatePath: string): string {
  let current = path.resolve(candidatePath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return parent;
    current = parent;
  }
  return current;
}

function realpath(candidatePath: string): string {
  return fs.realpathSync.native(candidatePath);
}

function normalizeRoot(root: string): string {
  return normalizePath(fs.existsSync(root) ? realpath(root) : path.resolve(root));
}

function normalizePath(candidatePath: string): string {
  return path.resolve(candidatePath).toLowerCase();
}

function isPathInsideRoot(candidatePath: string, root: string): boolean {
  return candidatePath === root || candidatePath.startsWith(`${root}${path.sep}`);
}

function hasWindowsAlternateDataStream(candidatePath: string): boolean {
  const parsed = path.parse(candidatePath);
  const withoutDrive = candidatePath.slice(parsed.root.length);
  return withoutDrive.split(/[\\/]/).some((segment) => segment.includes(':'));
}

function isUncPath(candidatePath: string): boolean {
  return /^\\\\[^\\]/.test(candidatePath);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}
