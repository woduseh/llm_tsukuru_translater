import fs from 'fs';
import path from 'path';

export type AgentExecutableStatus = 'available' | 'missing';

export interface AgentExecutableDetectionRequestItem {
  /** Stable preset id, echoed back in the result (e.g. 'codex', 'claude', 'generic'). */
  id: string;
  /** Candidate executable names to probe on PATH, in priority order. */
  executableNames: string[];
}

export interface AgentExecutableDetectionResultItem {
  id: string;
  status: AgentExecutableStatus;
}

export interface AgentExecutableDetectionResult {
  schemaVersion: 1;
  results: AgentExecutableDetectionResultItem[];
}

function safeIsFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Probe whether any of the given executable names is resolvable on PATH.
 * Read-only: only performs stat() on PATH-joined candidates. Never spawns.
 */
export function detectExecutableOnPath(
  executableNames: string[],
  env: NodeJS.ProcessEnv = process.env,
): { status: AgentExecutableStatus; resolvedPath?: string } {
  if (!Array.isArray(executableNames) || executableNames.length === 0) {
    return { status: 'missing' };
  }
  const rawPath = env.PATH ?? env.Path ?? env.path ?? '';
  const pathEntries = rawPath.split(path.delimiter).filter(Boolean);
  for (const name of executableNames) {
    if (typeof name !== 'string' || name.length === 0) continue;
    if (path.isAbsolute(name)) {
      if (safeIsFile(name)) return { status: 'available', resolvedPath: name };
      continue;
    }
    for (const entry of pathEntries) {
      const candidate = path.join(entry, name);
      if (safeIsFile(candidate)) return { status: 'available', resolvedPath: candidate };
    }
  }
  return { status: 'missing' };
}

function isValidRequestItem(value: unknown): value is AgentExecutableDetectionRequestItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string'
    && Array.isArray(item.executableNames)
    && item.executableNames.every((name) => typeof name === 'string')
  );
}

/**
 * Resolve detection status for a batch of agent CLI presets.
 * Invalid items are skipped so a single malformed entry can't break the batch.
 */
export function detectAgentExecutables(
  items: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AgentExecutableDetectionResult {
  const list = Array.isArray(items) ? items : [];
  const results: AgentExecutableDetectionResultItem[] = [];
  for (const candidate of list) {
    if (!isValidRequestItem(candidate)) continue;
    const { status } = detectExecutableOnPath(candidate.executableNames, env);
    results.push({ id: candidate.id, status });
  }
  return { schemaVersion: 1, results };
}
