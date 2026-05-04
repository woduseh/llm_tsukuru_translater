import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { FileManifestEntry, SandboxManifest } from '../types/agentWorkspace';

export interface SandboxManagerOptions {
  sourceRoot: string;
  sandboxRoot: string;
  sandboxId?: string;
  allowedRoots?: string[];
  maxReadBytes?: number;
}

export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxPathError';
  }
}

export class SandboxReadLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxReadLimitError';
  }
}

export class SandboxManager {
  readonly sandboxId: string;
  readonly sourceRoot: string;
  readonly sandboxRoot: string;
  readonly allowedRoots: string[];
  readonly maxReadBytes: number;
  readonly manifest: SandboxManifest;

  private constructor(options: Required<SandboxManagerOptions>, preManifest: FileManifestEntry[]) {
    this.sandboxId = options.sandboxId;
    this.sourceRoot = normalizeRoot(options.sourceRoot);
    this.sandboxRoot = normalizeRoot(options.sandboxRoot);
    this.allowedRoots = options.allowedRoots.map(normalizeRoot);
    this.maxReadBytes = options.maxReadBytes;
    this.manifest = {
      schemaVersion: 1,
      sandboxId: this.sandboxId,
      createdAt: new Date().toISOString(),
      sourceRoot: this.sourceRoot,
      sandboxRoot: this.sandboxRoot,
      allowedRoots: this.allowedRoots,
      preManifest,
    };
  }

  static create(options: SandboxManagerOptions): SandboxManager {
    const sandboxId = options.sandboxId ?? `sandbox-${Date.now()}-${process.pid}`;
    const sandboxRoot = path.resolve(options.sandboxRoot, sandboxId);
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    copyDirectory(options.sourceRoot, sandboxRoot);
    const allowedRoots = options.allowedRoots?.length ? options.allowedRoots : [sandboxRoot];
    return new SandboxManager({
      sourceRoot: options.sourceRoot,
      sandboxRoot,
      sandboxId,
      allowedRoots,
      maxReadBytes: options.maxReadBytes ?? 1024 * 1024,
    }, captureFileManifest(sandboxRoot));
  }

  resolveInsideAllowedRoot(candidatePath: string): string {
    if (isUncPath(candidatePath)) {
      throw new SandboxPathError(`UNC paths are not allowed: ${candidatePath}`);
    }
    if (hasWindowsAlternateDataStream(candidatePath)) {
      throw new SandboxPathError(`ADS paths are not allowed: ${candidatePath}`);
    }
    const resolved = path.resolve(this.sandboxRoot, candidatePath);
    const existingProbe = nearestExistingPath(resolved);
    const canonical = fs.existsSync(resolved) ? realpath(resolved) : path.resolve(realpath(existingProbe), path.relative(existingProbe, resolved));
    const normalized = normalizePath(canonical);
    const allowed = this.allowedRoots.some((root) => isPathInsideRoot(normalized, root));
    if (!allowed) {
      throw new SandboxPathError(`Path escapes allowed roots: ${candidatePath}`);
    }
    return canonical;
  }

  readTextFile(candidatePath: string): string {
    const resolved = this.resolveInsideAllowedRoot(candidatePath);
    const stats = fs.statSync(resolved);
    if (stats.size > this.maxReadBytes) {
      throw new SandboxReadLimitError(`Read exceeds ${this.maxReadBytes} bytes: ${candidatePath}`);
    }
    return fs.readFileSync(resolved, 'utf-8');
  }

  capturePostManifest(): SandboxManifest {
    this.manifest.postManifest = captureFileManifest(this.sandboxRoot);
    return this.manifest;
  }

  dispose(): void {
    fs.rmSync(this.sandboxRoot, { recursive: true, force: true });
  }
}

export function captureFileManifest(root: string): FileManifestEntry[] {
  if (!fs.existsSync(root)) return [];
  const entries: FileManifestEntry[] = [];
  walkFiles(root, (filePath) => {
    const stat = fs.statSync(filePath);
    const bytes = fs.readFileSync(filePath);
    entries.push({
      relativePath: path.relative(root, filePath),
      sizeBytes: stat.size,
      modifiedTimeMs: stat.mtimeMs,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  });
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function copyDirectory(sourceRoot: string, destinationRoot: string): void {
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function walkFiles(root: string, visit: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const current = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(current, visit);
    if (entry.isFile()) visit(current);
  }
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
