import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import type { JsonObject } from '../types/agentWorkspace';
import { ArtifactService } from './artifactService';
import { sanitizePathSegment } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';
import { AgentEventBus } from './eventBus';

export const JOB_GRAPH_NODE_TYPES = [
  'extract',
  'sample',
  'translate',
  'qa',
  'align',
  'repair',
  'patch',
  'verify',
  'apply',
  'memory.write',
  'glossary.update',
] as const;

export type JobGraphNodeType = typeof JOB_GRAPH_NODE_TYPES[number];
export type JobGraphNodeStatus = 'queued' | 'ready' | 'running' | 'completed' | 'blocked' | 'failed' | 'skipped';
export type JobGraphStatus = 'draft' | 'invalid' | 'ready' | 'running' | 'completed' | 'failed';

export interface JobGraphNodeInput {
  nodeId: string;
  type: JobGraphNodeType;
  title?: string;
  dependsOn?: string[];
  input?: JsonObject;
}

export interface JobGraphCreateInput {
  graphId?: string;
  title?: string;
  nodes: JobGraphNodeInput[];
  metadata?: JsonObject;
  ttlMs?: number;
}

export interface JobGraphNodeProgress {
  completed: number;
  total: number;
  message: string;
  updatedAt: string;
}

export interface JobGraphNode extends JobGraphNodeInput {
  title: string;
  dependsOn: string[];
  status: JobGraphNodeStatus;
  progress: JobGraphNodeProgress;
  artifactRefs: AgentDataRef[];
}

export interface JobGraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  order: string[];
}

export interface JobGraphManifest {
  schemaVersion: 1;
  graphId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: JobGraphStatus;
  dryRunOnly: true;
  nodes: JobGraphNode[];
  validation: JobGraphValidationResult;
  metadata: JsonObject;
  manifestRef?: AgentDataRef;
  dryRunRefs: AgentDataRef[];
}

export interface JobGraphDryRunResult {
  schemaVersion: 1;
  graphId: string;
  dryRunId: string;
  createdAt: string;
  order: string[];
  steps: JsonObject[];
  status: 'completed';
  sideEffects: [];
  dryRunRef?: AgentDataRef;
}

export class JobGraphService {
  private readonly indexPath: string;
  private readonly idFactory: () => string;

  constructor(
    private readonly options: {
      workspaceRoot: string;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
      eventBus?: AgentEventBus;
      idFactory?: () => string;
    },
  ) {
    this.indexPath = path.join(path.resolve(options.workspaceRoot), 'mcp', 'job-graphs.json');
    this.idFactory = options.idFactory ?? (() => `graph-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  create(input: JobGraphCreateInput): JobGraphManifest {
    const now = new Date().toISOString();
    const graphId = sanitizePathSegment(input.graphId ?? this.idFactory());
    const nodes = normalizeNodes(input.nodes, now);
    const manifest: JobGraphManifest = {
      schemaVersion: 1,
      graphId,
      title: input.title ?? graphId,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      dryRunOnly: true,
      nodes,
      validation: validateGraphNodes(nodes),
      metadata: input.metadata ?? {},
      dryRunRefs: [],
    };
    manifest.status = manifest.validation.valid ? 'ready' : 'invalid';
    const artifact = this.options.artifacts.writeJsonArtifact('job-graph-manifest', graphId, manifest as unknown as JsonObject);
    manifest.manifestRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'job-graph-manifest',
      scope: 'session',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'job.graph_create', graphId },
    });
    this.persist(manifest, `created ${manifest.status}`);
    return manifest;
  }

  validate(input: JobGraphCreateInput | { graphId: string }): JobGraphValidationResult {
    if ('graphId' in input && typeof input.graphId === 'string' && !('nodes' in input)) {
      return this.requireGraph(input.graphId).validation;
    }
    return validateGraphNodes(normalizeNodes((input as JobGraphCreateInput).nodes, new Date().toISOString()));
  }

  status(graphId: string): JsonObject {
    const graph = this.requireGraph(graphId);
    return {
      schemaVersion: 1,
      graphId: graph.graphId,
      title: graph.title,
      status: graph.status,
      validation: graph.validation as unknown as JsonObject,
      progress: graphProgress(graph),
      nodes: graph.nodes.map((node) => nodeStatus(node)) as unknown as JsonObject[],
      nextSuggestedCalls: graph.status === 'ready' ? ['workflow.dry_run', 'workflow.explain'] : ['job.graph_validate', 'workflow.explain'],
    };
  }

  artifacts(graphId: string): JsonObject {
    const graph = this.requireGraph(graphId);
    return {
      schemaVersion: 1,
      graphId: graph.graphId,
      manifestRef: graph.manifestRef,
      dryRunRefs: graph.dryRunRefs,
      nodeArtifactRefs: graph.nodes.flatMap((node) => node.artifactRefs.map((ref) => ({ nodeId: node.nodeId, ref }))),
    } as unknown as JsonObject;
  }

  dryRun(graphId: string, ttlMs?: number): JobGraphDryRunResult {
    const graph = this.requireGraph(graphId);
    const validation = validateGraphNodes(graph.nodes);
    if (!validation.valid) {
      graph.validation = validation;
      graph.status = 'invalid';
      this.persist(graph, 'dry-run blocked by invalid graph');
      throw new Error(`Job graph is invalid: ${validation.errors.join('; ')}`);
    }
    const now = new Date().toISOString();
    graph.status = 'running';
    for (const node of graph.nodes) {
      node.status = validation.order.includes(node.nodeId) ? 'ready' : 'blocked';
      node.progress = { completed: 0, total: 1, message: 'dry-run queued', updatedAt: now };
    }

    const steps: JsonObject[] = [];
    for (const nodeId of validation.order) {
      const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId) as JobGraphNode;
      node.status = 'completed';
      node.progress = { completed: 1, total: 1, message: `dry-run ${node.type} scaffold completed`, updatedAt: now };
      steps.push({
        nodeId: node.nodeId,
        type: node.type,
        title: node.title,
        dependsOn: node.dependsOn,
        action: dryRunAction(node.type),
        sideEffects: [],
      });
    }
    graph.status = 'completed';
    graph.updatedAt = now;
    const result: JobGraphDryRunResult = {
      schemaVersion: 1,
      graphId: graph.graphId,
      dryRunId: `dryrun-${graph.graphId}-${Date.now()}`,
      createdAt: now,
      order: validation.order,
      steps,
      status: 'completed',
      sideEffects: [],
    };
    const artifact = this.options.artifacts.writeJsonArtifact('workflow-dry-run', result.dryRunId, result as unknown as JsonObject);
    result.dryRunRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'workflow-dry-run',
      scope: 'session',
      ttlMs,
      metadata: { toolName: 'workflow.dry_run', graphId: graph.graphId },
    });
    graph.dryRunRefs.push(result.dryRunRef);
    this.persist(graph, 'dry-run completed');
    return result;
  }

  get(graphId: string): JobGraphManifest | undefined {
    return this.readIndex()[sanitizePathSegment(graphId)];
  }

  private requireGraph(graphId: string): JobGraphManifest {
    const graph = this.get(graphId);
    if (!graph) throw new Error(`Unknown job graph: ${graphId}`);
    return graph;
  }

  private persist(graph: JobGraphManifest, message: string): void {
    graph.updatedAt = new Date().toISOString();
    const index = this.readIndex();
    index[graph.graphId] = graph;
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    atomicWriteJsonFile(this.indexPath, index, 2);
    this.options.eventBus?.emit({ kind: 'mcp', toolName: 'job.graph', status: graph.status, metadata: { graphId: graph.graphId, message } });
  }

  private readIndex(): Record<string, JobGraphManifest> {
    if (!fs.existsSync(this.indexPath)) return {};
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as Record<string, JobGraphManifest>;
  }
}

export function validateGraphNodes(nodes: JobGraphNodeInput[]): JobGraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set<string>();
  const typeSet = new Set<string>(JOB_GRAPH_NODE_TYPES);
  for (const node of nodes) {
    if (!node.nodeId || typeof node.nodeId !== 'string') errors.push('Every node requires a non-empty nodeId.');
    if (known.has(node.nodeId)) errors.push(`Duplicate nodeId: ${node.nodeId}`);
    known.add(node.nodeId);
    if (!typeSet.has(node.type)) errors.push(`Unsupported node type for ${node.nodeId}: ${String(node.type)}`);
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (!known.has(dep)) errors.push(`Node ${node.nodeId} depends on unknown node: ${dep}`);
      if (dep === node.nodeId) errors.push(`Node ${node.nodeId} cannot depend on itself.`);
    }
  }
  const cycle = findCycle(nodes);
  if (cycle.length) errors.push(`Cycle detected: ${cycle.join(' -> ')}`);
  const order = errors.length === 0 ? topologicalOrder(nodes) : [];
  if (nodes.length === 0) warnings.push('Graph has no nodes.');
  return { valid: errors.length === 0, errors, warnings, order };
}

function normalizeNodes(nodes: JobGraphNodeInput[], now: string): JobGraphNode[] {
  return (nodes ?? []).map((node) => ({
    ...node,
    nodeId: sanitizePathSegment(node.nodeId),
    title: node.title ?? defaultTitle(node.type),
    dependsOn: [...(node.dependsOn ?? [])].map(sanitizePathSegment),
    input: node.input ?? {},
    status: 'queued',
    progress: { completed: 0, total: 1, message: 'queued', updatedAt: now },
    artifactRefs: [],
  }));
}

function findCycle(nodes: JobGraphNodeInput[]): string[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (nodeId: string): string[] => {
    if (visiting.has(nodeId)) return [...stack.slice(stack.indexOf(nodeId)), nodeId];
    if (visited.has(nodeId)) return [];
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const dep of byId.get(nodeId)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle.length) return cycle;
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return [];
  };
  for (const node of nodes) {
    const cycle = visit(node.nodeId);
    if (cycle.length) return cycle;
  }
  return [];
}

function topologicalOrder(nodes: JobGraphNodeInput[]): string[] {
  const pending = new Map(nodes.map((node) => [node.nodeId, new Set(node.dependsOn ?? [])]));
  const order: string[] = [];
  while (pending.size > 0) {
    const ready = Array.from(pending.entries())
      .filter(([, deps]) => deps.size === 0)
      .map(([nodeId]) => nodeId);
    if (ready.length === 0) return [];
    for (const nodeId of ready) {
      pending.delete(nodeId);
      order.push(nodeId);
      for (const deps of pending.values()) deps.delete(nodeId);
    }
  }
  return order;
}

function defaultTitle(type: JobGraphNodeType): string {
  return type.split('.').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function dryRunAction(type: JobGraphNodeType): string {
  const actions: Record<JobGraphNodeType, string> = {
    extract: 'Would inspect extraction inputs and produce extract artifacts after future approval.',
    sample: 'Would sample bounded corpus lines for planning.',
    translate: 'Would call configured translator after future approval.',
    qa: 'Would evaluate deterministic QA gates.',
    align: 'Would inspect source/target line alignment.',
    repair: 'Would propose repair candidates without mutating files.',
    patch: 'Would create a dry-run patch preview.',
    verify: 'Would verify JSON/text invariants.',
    apply: 'Would request approval before applying translated text.',
    'memory.write': 'Would write project memory after future mutation approval.',
    'glossary.update': 'Would update glossary after future mutation approval.',
  };
  return actions[type];
}

function graphProgress(graph: JobGraphManifest): JsonObject {
  const completed = graph.nodes.filter((node) => node.status === 'completed').length;
  return { completed, total: graph.nodes.length, percent: graph.nodes.length ? Math.round((completed / graph.nodes.length) * 100) : 100 };
}

function nodeStatus(node: JobGraphNode): JsonObject {
  return {
    nodeId: node.nodeId,
    type: node.type,
    title: node.title,
    dependsOn: node.dependsOn,
    status: node.status,
    progress: node.progress as unknown as JsonObject,
    artifactRefCount: node.artifactRefs.length,
  };
}
