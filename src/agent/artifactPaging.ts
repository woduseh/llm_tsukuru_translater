import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { JsonObject, JsonValue } from '../types/agentWorkspace';
import type { AgentArtifactRecord } from './artifactService';
import { atomicWriteTextFile } from '../ts/libs/atomicFile';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import type { AgentWorkspaceStorage } from './agentWorkspaceStorage';
import { SandboxReadLimitError } from './agentFileErrors';

export const MAX_ARTIFACT_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_ARTIFACT_ITEM_BYTES = 48 * 1024 - 2;
const PAGE_BYTES = 512 * 1024;
const PAGE_ROWS = 4096;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const COLLECTIONS = ['refs', 'breaks', 'findings', 'operations'] as const;
type Collection = typeof COLLECTIONS[number];
export interface ArtifactStorage {
  generation: string;
  collections: Partial<Record<Collection, { total: number; pages: { start: number; count: number }[] }>>;
}

export function collectionParent(content: JsonObject, name: string): JsonObject {
  return name === 'operations' && content.patch && typeof content.patch === 'object' && !Array.isArray(content.patch)
    ? content.patch as JsonObject : content;
}

/** Publish a small manifest only after its immutable collection pages are durable. */
export function writeArtifactRecord(record: AgentArtifactRecord, workspace: AgentWorkspaceStorage): void {
  const storage: ArtifactStorage = { generation: randomUUID(), collections: {} };
  const directory = `${record.path}.${storage.generation}.pages`;
  const object = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as JsonObject : null;
  const content = object ? { ...object } : null;
  if (content?.patch && typeof content.patch === 'object' && !Array.isArray(content.patch)) content.patch = { ...content.patch };
  let directoryCreated = false;
  let bytesWritten = 0;
  try {
    for (const name of COLLECTIONS) {
      if (!content) break;
      const parent = collectionParent(content, name);
      const rows = parent[name];
      if (!Array.isArray(rows)) continue;
      const chunks: { start: number; count: number }[] = [];
      let batch: string[] = [], batchBytes = 2, start = 0;
      const flush = () => {
        if (!directoryCreated) {
          workspace.ensureDirectory(path.relative(workspace.workspaceRoot, directory));
          directoryCreated = true;
        }
        const json = `[${batch.join(',')}]`;
        bytesWritten += Buffer.byteLength(json);
        if (bytesWritten > MAX_ARTIFACT_BYTES) throw new SandboxReadLimitError('Analysis artifact exceeds 64 MiB; inspect a smaller input.');
        const pagePath = path.join(directory, `${name}-${chunks.length}.json`);
        atomicWriteTextFile(workspace.resolve(pagePath), json, { cleanupStaleTempFiles: false });
        chunks.push({ start, count: batch.length }); start += batch.length;
        batch = []; batchBytes = 2;
      };
      for (const row of rows) {
        const json = JSON.stringify(row);
        const bytes = Buffer.byteLength(json);
        if (bytes > MAX_ARTIFACT_ITEM_BYTES) throw new SandboxReadLimitError('One artifact item exceeds the page byte budget. Use translation.read_window for line context.');
        if (batch.length && (batch.length === PAGE_ROWS || batchBytes + bytes + 1 > PAGE_BYTES)) flush();
        batch.push(json); batchBytes += bytes + (batch.length > 1 ? 1 : 0);
      }
      if (chunks.length) {
        if (batch.length) flush();
        storage.collections[name] = { total: rows.length, pages: chunks };
        parent[name] = [];
      }
    }
    const diskRecord = directoryCreated ? { ...record, payload: content, storage } : record;
    const json = JSON.stringify(diskRecord);
    const bytes = Buffer.byteLength(json);
    if (bytes > MAX_ARTIFACT_JSON_BYTES || bytesWritten + bytes > MAX_ARTIFACT_BYTES) {
      throw new SandboxReadLimitError('Artifact metadata exceeds its JSON read budget; inspect a smaller input.');
    }
    atomicWriteTextFile(workspace.resolve(record.path), json);
  } catch (error) {
    if (directoryCreated) fs.rmSync(workspace.resolve(directory), { recursive: true, force: true });
    throw error;
  }
}

/** Return only the pages intersecting the requested slice. Legacy inline arrays stay readable. */
export function readArtifactCollection(record: AgentArtifactRecord, target: string, name: string, offset: number, limit: number) {
  const content = record.payload as JsonObject;
  const descriptor = record.storage?.collections?.[name as Collection];
  if (!descriptor) {
    const rows = collectionParent(content, name)[name];
    if (!Array.isArray(rows)) throw new Error(`Artifact has no ${name} collection.`);
    return { total: rows.length, rows: rows.slice(offset, offset + limit) };
  }
  const generation = record.storage!.generation;
  if (!COLLECTIONS.includes(name as Collection) || !/^[0-9a-f-]{36}$/.test(generation)
    || !Number.isSafeInteger(descriptor.total) || descriptor.total < 0 || !Array.isArray(descriptor.pages)) {
    throw new Error('Invalid paged artifact metadata.');
  }
  let expected = 0;
  for (const page of descriptor.pages) {
    if (page.start !== expected || !Number.isSafeInteger(page.count) || page.count < 1 || page.count > PAGE_ROWS) {
      throw new Error('Invalid paged artifact coverage.');
    }
    expected += page.count;
  }
  if (expected !== descriptor.total) throw new Error('Incomplete paged artifact coverage.');
  const safe = new AgentSafeFileSystem({ projectRoot: path.dirname(target) });
  const rows: JsonValue[] = [];
  for (const [index, page] of descriptor.pages.entries()) {
    if (page.start >= offset + limit) break;
    if (page.start + page.count <= offset) continue;
    const file = safe.resolveAllowed(`${target}.${generation}.pages/${name}-${index}.json`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > PAGE_BYTES) throw new SandboxReadLimitError('Artifact collection page exceeds its byte budget.');
    const values = JSON.parse(fs.readFileSync(file, 'utf8')) as JsonValue[];
    if (!Array.isArray(values) || values.length !== page.count) throw new Error('Invalid artifact collection page.');
    rows.push(...values.slice(Math.max(0, offset - page.start), Math.min(page.count, offset + limit - page.start)));
  }
  return { total: descriptor.total, rows };
}
