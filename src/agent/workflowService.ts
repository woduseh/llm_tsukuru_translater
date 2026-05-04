import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import type { JsonObject } from '../types/agentWorkspace';
import { ArtifactService, sanitizePathSegment } from './artifactService';
import type { AgentDataRef } from './dataRefService';
import { DataRefService } from './dataRefService';
import type { JobGraphCreateInput, JobGraphNodeInput } from './jobGraphService';
import { JOB_GRAPH_NODE_TYPES, JobGraphService, validateGraphNodes } from './jobGraphService';

export interface WorkflowComposeInput {
  workflowId?: string;
  title?: string;
  preset?: 'translation-review' | 'safe-apply' | 'repair-loop' | 'memory-glossary';
  nodes?: JobGraphNodeInput[];
  metadata?: JsonObject;
}

export interface WorkflowRecipe {
  schemaVersion: 1;
  recipeId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  graph: JobGraphCreateInput;
  recipeRef?: AgentDataRef;
}

export class WorkflowService {
  private readonly recipePath: string;

  constructor(
    private readonly options: {
      workspaceRoot: string;
      graphs: JobGraphService;
      artifacts: ArtifactService;
      dataRefs: DataRefService;
    },
  ) {
    this.recipePath = path.join(path.resolve(options.workspaceRoot), 'mcp', 'workflow-recipes.json');
  }

  compose(input: WorkflowComposeInput = {}): JobGraphCreateInput {
    const preset = input.preset ?? 'translation-review';
    const nodes = input.nodes ?? presetNodes(preset);
    return {
      graphId: input.workflowId,
      title: input.title ?? presetTitle(preset),
      nodes,
      metadata: { preset, ...(input.metadata ?? {}) },
    };
  }

  validate(input: WorkflowComposeInput | JobGraphCreateInput | { graphId: string }): JsonObject {
    if ('graphId' in input && typeof input.graphId === 'string' && !('nodes' in input) && !('preset' in input)) {
      return this.options.graphs.validate({ graphId: input.graphId }) as unknown as JsonObject;
    }
    const graph = 'nodes' in input && Array.isArray(input.nodes) && !('preset' in input)
      ? input as JobGraphCreateInput
      : this.compose(input as WorkflowComposeInput);
    return validateGraphNodes(graph.nodes) as unknown as JsonObject;
  }

  dryRun(input: WorkflowComposeInput | { graphId: string; ttlMs?: number }): JsonObject {
    const graphId = 'graphId' in input && typeof input.graphId === 'string' ? input.graphId : undefined;
    if (graphId) {
      const existing = this.options.graphs.get(graphId);
      if (!existing) throw new Error(`Unknown job graph: ${graphId}`);
      return this.options.graphs.dryRun(existing.graphId, 'ttlMs' in input && typeof input.ttlMs === 'number' ? input.ttlMs : undefined) as unknown as JsonObject;
    }
    const graph = this.options.graphs.create(this.compose(input as WorkflowComposeInput));
    return this.options.graphs.dryRun(graph.graphId, 'ttlMs' in input && typeof input.ttlMs === 'number' ? input.ttlMs : undefined) as unknown as JsonObject;
  }

  explain(input: WorkflowComposeInput | JobGraphCreateInput | { graphId: string }): JsonObject {
    const existing = 'graphId' in input && typeof input.graphId === 'string' && this.options.graphs.get(input.graphId);
    const graph = existing
      ? existing
      : this.options.graphs.create('nodes' in input && Array.isArray(input.nodes) && !('preset' in input)
        ? input as JobGraphCreateInput
        : this.compose(input as WorkflowComposeInput));
    const validation = graph.validation;
    return {
      schemaVersion: 1,
      graphId: graph.graphId,
      title: graph.title,
      status: graph.status,
      summary: validation.valid
        ? `Workflow has ${graph.nodes.length} node(s) and can be dry-run in dependency order.`
        : `Workflow is invalid: ${validation.errors.join('; ')}`,
      nodeTypes: JOB_GRAPH_NODE_TYPES,
      order: validation.order,
      nodes: graph.nodes.map((node) => ({ nodeId: node.nodeId, type: node.type, dependsOn: node.dependsOn })),
      limitations: [
        'This scaffold performs dry-runs only.',
        'Extract, translate, apply, memory, and glossary mutations require future approval-mutation tools.',
      ],
      nextSuggestedCalls: validation.valid ? ['workflow.dry_run', 'job.graph_status', 'job.graph_artifacts'] : ['workflow.validate'],
    } as unknown as JsonObject;
  }

  saveRecipe(input: { recipeId?: string; title?: string; workflow?: WorkflowComposeInput; graph?: JobGraphCreateInput; ttlMs?: number }): WorkflowRecipe {
    const now = new Date().toISOString();
    const graph = input.graph ?? this.compose(input.workflow ?? {});
    const validation = validateGraphNodes(graph.nodes);
    if (!validation.valid) throw new Error(`Cannot save invalid workflow recipe: ${validation.errors.join('; ')}`);
    const recipeId = sanitizePathSegment(input.recipeId ?? graph.graphId ?? `recipe-${Date.now()}`);
    const recipes = this.readRecipes();
    const recipe: WorkflowRecipe = {
      schemaVersion: 1,
      recipeId,
      title: input.title ?? graph.title ?? recipeId,
      createdAt: recipes[recipeId]?.createdAt ?? now,
      updatedAt: now,
      graph: { ...graph, graphId: graph.graphId ?? recipeId },
    };
    const artifact = this.options.artifacts.writeJsonArtifact('workflow-recipe', recipeId, recipe as unknown as JsonObject);
    recipe.recipeRef = this.options.dataRefs.registerArtifactRef(artifact, {
      kind: 'workflow-recipe',
      scope: 'project',
      ttlMs: input.ttlMs,
      metadata: { toolName: 'workflow.save_recipe', recipeId },
    });
    recipes[recipeId] = recipe;
    fs.mkdirSync(path.dirname(this.recipePath), { recursive: true });
    atomicWriteJsonFile(this.recipePath, recipes, 2);
    return recipe;
  }

  listRecipes(): JsonObject {
    return {
      schemaVersion: 1,
      recipes: Object.values(this.readRecipes()).sort((left, right) => left.recipeId.localeCompare(right.recipeId, 'en')),
    } as unknown as JsonObject;
  }

  private readRecipes(): Record<string, WorkflowRecipe> {
    if (!fs.existsSync(this.recipePath)) return {};
    return JSON.parse(fs.readFileSync(this.recipePath, 'utf-8')) as Record<string, WorkflowRecipe>;
  }
}

function presetNodes(preset: NonNullable<WorkflowComposeInput['preset']>): JobGraphNodeInput[] {
  if (preset === 'safe-apply') {
    return [
      { nodeId: 'qa', type: 'qa' },
      { nodeId: 'verify', type: 'verify', dependsOn: ['qa'] },
      { nodeId: 'apply', type: 'apply', dependsOn: ['verify'] },
    ];
  }
  if (preset === 'repair-loop') {
    return [
      { nodeId: 'qa', type: 'qa' },
      { nodeId: 'align', type: 'align', dependsOn: ['qa'] },
      { nodeId: 'repair', type: 'repair', dependsOn: ['align'] },
      { nodeId: 'patch', type: 'patch', dependsOn: ['repair'] },
      { nodeId: 'verify', type: 'verify', dependsOn: ['patch'] },
    ];
  }
  if (preset === 'memory-glossary') {
    return [
      { nodeId: 'sample', type: 'sample' },
      { nodeId: 'glossary-update', type: 'glossary.update', dependsOn: ['sample'] },
      { nodeId: 'memory-write', type: 'memory.write', dependsOn: ['sample'] },
    ];
  }
  return [
    { nodeId: 'extract', type: 'extract' },
    { nodeId: 'sample', type: 'sample', dependsOn: ['extract'] },
    { nodeId: 'translate', type: 'translate', dependsOn: ['sample'] },
    { nodeId: 'qa', type: 'qa', dependsOn: ['translate'] },
    { nodeId: 'align', type: 'align', dependsOn: ['qa'] },
    { nodeId: 'repair', type: 'repair', dependsOn: ['align'] },
    { nodeId: 'patch', type: 'patch', dependsOn: ['repair'] },
    { nodeId: 'verify', type: 'verify', dependsOn: ['patch'] },
    { nodeId: 'apply', type: 'apply', dependsOn: ['verify'] },
  ];
}

function presetTitle(preset: NonNullable<WorkflowComposeInput['preset']>): string {
  const titles: Record<NonNullable<WorkflowComposeInput['preset']>, string> = {
    'translation-review': 'Translation review workflow',
    'safe-apply': 'Safe apply workflow',
    'repair-loop': 'Repair loop workflow',
    'memory-glossary': 'Memory and glossary workflow',
  };
  return titles[preset];
}
