import * as fs from 'fs';
import * as path from 'path';
import type { AgentService } from '../agent/agentService';
import type { AlignmentInspectOptions } from '../agent/alignmentService';
import type { BatchPlanOptions } from '../agent/batchPlanningService';
import type { CorpusSampleOptions } from '../agent/corpusSamplingService';
import {
  AGENT_SKILL_RECIPES,
  createSafeRecipePayload,
  createTranslationWorkflowPayload,
  explainReadonlyTool,
  type AgentSkillGuideTopic,
} from '../agent/agentSkillGuide';
import { redactSecretLikeValues } from '../agent/contractsValidation';
import type { GlossarySearchOptions } from '../agent/glossaryService';
import type { JobGraphCreateInput } from '../agent/jobGraphService';
import type { MemorySearchOptions } from '../agent/memoryService';
import type { PatchProposeOptions } from '../agent/patchService';
import type { QaBatchScoreOptions, QaCompareVersionsOptions, QaExplainScoreOptions, QaScoreFileOptions, QaThresholdGateOptions } from '../agent/qaService';
import type { RepairLoopOptions } from '../agent/repairLoopService';
import type { WorkflowComposeInput } from '../agent/workflowService';
import type { AgentResultEnvelope, AuditEntry, JsonObject, McpToolDefinition, PermissionTier, TranslationPatch } from '../types/agentWorkspace';
import type { AppSettings } from '../types/settings';
import { LLM_PROVIDER_SECRET_SETTING_KEYS } from '../types/llmProviderContract';
import { listProviderRegistryEntries, validateProviderReadiness } from '../ts/libs/providerRegistry';
import { scanProjectTranslationProfile } from '../ts/libs/projectProfile';

export type ReadonlyToolHandler = (args: JsonObject, context: ReadonlyToolContext) => JsonObject;

export interface ReadonlyToolContext {
  requestId: string;
  service: AgentService;
  settings?: Partial<AppSettings> & Record<string, unknown>;
}

interface RegisteredReadonlyTool {
  definition: McpToolDefinition;
  handler: ReadonlyToolHandler;
}

export class McpReadonlyToolRegistry {
  private readonly tools = new Map<string, RegisteredReadonlyTool>();

  constructor(
    private readonly service: AgentService,
    private readonly options: { settings?: Partial<AppSettings> & Record<string, unknown> } = {},
  ) {}

  register(definition: McpToolDefinition, handler: ReadonlyToolHandler): void {
    if (definition.permissionTier !== 'readonly') {
      throw new Error(`MCP read-only registry cannot register ${definition.name} with ${definition.permissionTier}`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  callTool(name: string, args: JsonObject = {}, requestId = createRequestId(name)): AgentResultEnvelope {
    const tool = this.tools.get(name);
    if (!tool) return failureEnvelope(requestId, name, 'readonly', `Unknown MCP tool: ${name}`);
    try {
      const payload = tool.handler(args, { requestId, service: this.service, settings: this.options.settings });
      return okEnvelope(requestId, name, tool.definition.permissionTier, payload);
    } catch (error) {
      return failureEnvelope(requestId, name, tool.definition.permissionTier, error instanceof Error ? error.message : String(error));
    }
  }
}

export function createMcpReadonlyToolRegistry(
  service: AgentService,
  options: { settings?: Partial<AppSettings> & Record<string, unknown> } = {},
): McpReadonlyToolRegistry {
  const registry = new McpReadonlyToolRegistry(service, options);
  for (const tool of createReadonlyToolDefinitions()) {
    registry.register(tool.definition, tool.handler);
  }
  return registry;
}

export function createReadonlyToolDefinitions(): RegisteredReadonlyTool[] {
  return [
    {
      definition: {
        name: 'project.context_snapshot',
        title: 'Project context snapshot',
        description: 'Returns bounded project, workspace, job, and MCP tool context without file contents.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { service }) => {
        const refreshed = service.refreshManifest();
        return toJsonObject({
          projectRoot: refreshed.projectRoot,
          workspaceRoot: refreshed.workspaceRoot,
          manifestPath: path.relative(refreshed.projectRoot, refreshed.manifestPath),
          engine: refreshed.manifest.engine,
          currentJobs: refreshed.manifest.currentJobs,
          lastFailures: refreshed.manifest.lastFailures,
          availableReadonlyTools: createReadonlyToolDefinitions().map((tool) => tool.definition.name),
        });
      },
    },
    {
      definition: {
        name: 'settings.get_sanitized',
        title: 'Get sanitized settings',
        description: 'Returns renderer-safe settings metadata with provider secrets removed.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { settings }) => sanitizeSettings(settings),
    },
    {
      definition: {
        name: 'provider.list',
        title: 'List LLM providers',
        description: 'Lists provider metadata and capabilities without credentials.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: () => ({
        providers: listProviderRegistryEntries().map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          defaultModel: entry.defaultModel,
          modelSuggestions: [...entry.modelSuggestions],
          capabilities: [...entry.capabilities],
          maxRecommendedConcurrency: entry.maxRecommendedConcurrency,
          settingFields: entry.settingFields.map((field) => ({
            key: field.key,
            label: field.label,
            kind: field.kind,
            required: field.required,
            rendererSafe: field.rendererSafe,
            secret: field.secret,
          })),
          secretsRedacted: true,
        })),
      }),
    },
    {
      definition: {
        name: 'provider.readiness',
        title: 'Provider readiness',
        description: 'Returns deterministic readiness for sanitized app settings.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { settings }) => ({
        readiness: validateProviderReadiness(settings ?? {}) as unknown as JsonObject,
        secretsRedacted: true,
      }),
    },
    {
      definition: {
        name: 'project.get_quality_rules',
        title: 'Project quality rules',
        description: 'Returns built-in agent quality rules and docs path.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { service }) => ({
        qualityRules: service.refreshManifest().manifest.qualityRules,
        docsPath: fs.existsSync(path.resolve('docs', 'QUALITY_RULES.md')) ? 'docs\\QUALITY_RULES.md' : null,
      }),
    },
    {
      definition: {
        name: 'project.translation_inventory',
        title: 'Project translation inventory',
        description: 'Scans project paths for translation inputs, extracted text, and metadata without returning contents.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', properties: { maxFiles: { type: 'number' } }, additionalProperties: false },
      },
      handler: (args, { service }) => buildTranslationInventory(service.descriptor.projectRoot, numberArg(args.maxFiles, 500)),
    },
    {
      definition: {
        name: 'project.scan_profile',
        title: 'Project scan profile',
        description: 'Runs the bounded translation profile scanner in read-only mode.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', properties: { maxFiles: { type: 'number' } }, additionalProperties: false },
      },
      handler: (args, { service }) => scanProjectTranslationProfile(service.descriptor.projectRoot, { maxFiles: numberArg(args.maxFiles, 50) }) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'quality.review_file',
        title: 'Review translation file',
        description: 'Reads a bounded text file and reports minimal line, separator, empty-line, and control-code invariants.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            maxBytes: { type: 'number' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => reviewFile(service, args),
    },
    {
      definition: {
        name: 'harness.latest',
        title: 'Latest harness artifact',
        description: 'Returns metadata from the latest harness JSON artifact when one exists.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { service }) => latestHarnessArtifact(service.descriptor.projectRoot),
    },
    {
      definition: {
        name: 'artifacts.read_ref',
        title: 'Read data or artifact ref',
        description: 'Reads a bounded, redacted artifact/data ref created for this project and session.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            refId: { type: 'string' },
            maxBytes: { type: 'number' },
          },
          required: ['refId'],
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => {
        if (typeof args.refId !== 'string' || args.refId.trim() === '') throw new Error('artifacts.read_ref requires a non-empty string refId.');
        return service.dataRefs.readRef(args.refId, {
          maxBytes: numberArg(args.maxBytes, 64 * 1024),
          projectRoot: service.descriptor.projectRoot,
        }) as unknown as JsonObject;
      },
    },
    {
      definition: {
        name: 'batch.estimate',
        title: 'Estimate translation batch plan',
        description: 'Dry-run estimate from translation inventory/filter/scope without executing translation.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.batch.estimate(args as unknown as BatchPlanOptions),
    },
    {
      definition: {
        name: 'batch.plan',
        title: 'Plan translation batches',
        description: 'Creates a dry-run batch manifest artifact/ref from translation inventory/filter/scope.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.batch.plan(args as unknown as BatchPlanOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'corpus.sample',
        title: 'Sample translation corpus',
        description: 'Returns bounded redacted samples by deterministic, random, longest, control-code, untranslated, or failure-hotspot strategy.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.corpus.sample(args as unknown as CorpusSampleOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'alignment.inspect',
        title: 'Inspect translation alignment',
        description: 'Builds a dry-run alignment map/ref for source and target .txt files, checking separators, empty lines, control codes, and metadata spans when provided.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.alignment.inspect(args as unknown as AlignmentInspectOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'alignment.find_breaks',
        title: 'Find alignment breaks',
        description: 'Returns deterministic alignment invariant breaks without changing files.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.alignment.findBreaks(args as unknown as AlignmentInspectOptions),
    },
    {
      definition: {
        name: 'alignment.score',
        title: 'Score translation alignment',
        description: 'Returns an alignment confidence score from line-count, separator, empty-line, speaker-label, and RPG control-code invariants.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.alignment.score(args as unknown as AlignmentInspectOptions),
    },
    {
      definition: {
        name: 'alignment.explain',
        title: 'Explain alignment result',
        description: 'Explains the most important alignment breaks and safe repair constraints.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.alignment.explain(args as unknown as AlignmentInspectOptions),
    },
    {
      definition: {
        name: 'qa.score_file',
        title: 'Score translated file QA',
        description: 'Scores deterministic QA dimensions for a translated .txt file using alignment, glossary, memory, and metadata checks.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.qa.scoreFile(args as unknown as QaScoreFileOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'qa.score_batch',
        title: 'Score translated batch QA',
        description: 'Scores multiple translated files and returns an aggregate deterministic QA gate summary.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.qa.scoreBatch(args as unknown as QaBatchScoreOptions),
    },
    {
      definition: {
        name: 'qa.explain_score',
        title: 'Explain QA score',
        description: 'Explains top deterministic QA findings and suggested next tool calls for a score or score ref.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.qa.explainScore(args as unknown as QaExplainScoreOptions),
    },
    {
      definition: {
        name: 'qa.read_score_ref',
        title: 'Read QA score ref',
        description: 'Reads a bounded, redacted QA score artifact ref created by qa.score_file.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', properties: { refId: { type: 'string' } }, required: ['refId'], additionalProperties: false },
      },
      handler: (args, { service }) => {
        if (typeof args.refId !== 'string' || args.refId.trim() === '') throw new Error('qa.read_score_ref requires a non-empty string refId.');
        return service.qa.readScoreRefPayload(args.refId);
      },
    },
    {
      definition: {
        name: 'qa.suggest_next_calls',
        title: 'Suggest QA next calls',
        description: 'Returns deterministic next suggested MCP calls for a QA score, score ref, or file input.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.qa.suggestNextCalls(args as unknown as QaExplainScoreOptions),
    },
    {
      definition: {
        name: 'qa.threshold_gate',
        title: 'Gate apply preview by QA threshold',
        description: 'Returns a deterministic pass/block gate for apply preview scaffolding without changing actual apply execution.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.qa.thresholdGate(args as unknown as QaThresholdGateOptions),
    },
    {
      definition: {
        name: 'qa.compare_versions',
        title: 'Compare QA score versions',
        description: 'Scores candidate target versions against the same source and reports the best deterministic QA result.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.qa.compareVersions(args as unknown as QaCompareVersionsOptions),
    },
    {
      definition: {
        name: 'patch.propose',
        title: 'Propose dry-run translation patch',
        description: 'Creates a dry-run-only same-line replacement or virtual-note patch/ref. No files are modified.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.patch.propose(args as unknown as PatchProposeOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'patch.validate',
        title: 'Validate translation patch invariants',
        description: 'Validates dry-run patch invariants, rejecting line-count-changing replacements unless a future alignment proof protocol is implemented.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.patch.validate(requirePatchArg(args)) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'patch.preview',
        title: 'Preview dry-run translation patch',
        description: 'Returns before/after same-line hunks for a dry-run patch without modifying files.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => {
        const patch = isPatchLike(args.patch) ? args.patch as unknown as TranslationPatch : service.patch.propose(args as unknown as PatchProposeOptions).patch;
        return service.patch.preview(patch) as unknown as JsonObject;
      },
    },
    {
      definition: {
        name: 'repair.loop_plan',
        title: 'Plan auto repair loop',
        description: 'Builds a dry-run auto-repair plan from QA scoring, alignment findings, patch planning, and hard-stop rules.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.repair.loopPlan(args as unknown as RepairLoopOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'repair.loop_run',
        title: 'Run auto repair loop simulation',
        description: 'Runs the auto-repair loop in dry-run simulation mode; no project files are modified and patch.apply remains separate approval-gated infrastructure.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.repair.loopRun(args as unknown as RepairLoopOptions) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'repair.loop_status',
        title: 'Read auto repair loop status',
        description: 'Reads the job-backed status for a repair loop run.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.repair.loopStatus(args as { loopId?: string; jobId?: string }),
    },
    {
      definition: {
        name: 'repair.loop_stop',
        title: 'Stop auto repair loop scaffold',
        description: 'Marks a job-backed repair loop scaffold as stopped; no external process or project file is modified.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.repair.loopStop(args as { loopId?: string; jobId?: string; reason?: string }),
    },
    {
      definition: {
        name: 'repair.loop_report',
        title: 'Read auto repair loop report',
        description: 'Returns repair loop findings, actions, artifacts, hard stops, and next suggested calls.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.repair.loopReport(args as { loopId?: string; jobId?: string }),
    },
    {
      definition: {
        name: 'glossary.search',
        title: 'Search project glossary',
        description: 'Searches project-local glossary entries without writing project files.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            engineType: { type: 'string' },
            speaker: { type: 'string' },
            minConfidence: { type: 'number' },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => ({ entries: service.glossary.search(args as unknown as GlossarySearchOptions) as unknown as JsonObject[] }),
    },
    {
      definition: {
        name: 'glossary.propose_entries',
        title: 'Propose glossary entries from corpus sample',
        description: 'Returns bounded glossary entry suggestions from a deterministic corpus sample; does not persist them.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            confidence: { type: 'number' },
            sample: { type: 'object' },
          },
          additionalProperties: true,
        },
      },
      handler: (args, { service }) => {
        const sample = args.sample && typeof args.sample === 'object'
          ? args.sample as unknown as CorpusSampleOptions
          : { maxSamples: 12, strategy: 'deterministic' } as CorpusSampleOptions;
        return {
          proposals: service.glossary.proposeEntriesFromCorpus(service.corpus.sample(sample), {
            limit: numberArg(args.limit, 10),
            confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
          }) as unknown as JsonObject[],
        };
      },
    },
    {
      definition: {
        name: 'glossary.validate_usage',
        title: 'Validate glossary usage',
        description: 'Checks bounded text for preferred and forbidden glossary usage.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => {
        if (typeof args.text !== 'string') throw new Error('glossary.validate_usage requires a string text.');
        return service.glossary.validateUsage(args.text) as unknown as JsonObject;
      },
    },
    {
      definition: {
        name: 'memory.search',
        title: 'Search project agent memory',
        description: 'Searches project-local agent memory entries without writing project files.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            type: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            includeForgotten: { type: 'boolean' },
            minConfidence: { type: 'number' },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => ({ entries: service.memory.search(args as unknown as MemorySearchOptions) as unknown as JsonObject[] }),
    },
    {
      definition: {
        name: 'memory.summarize',
        title: 'Summarize project agent memory',
        description: 'Returns counts and bounded summaries from project-local agent memory.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.memory.summarize(args as unknown as MemorySearchOptions),
    },
    {
      definition: {
        name: 'job.graph_create',
        title: 'Create dry-run job graph',
        description: 'Creates a persisted dry-run-only DAG manifest/ref for agent workflow nodes without executing project mutations.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.jobGraphs.create(args as unknown as JobGraphCreateInput) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'job.graph_validate',
        title: 'Validate job graph',
        description: 'Validates job graph dependencies, unknown nodes, supported node types, and cycles.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.jobGraphs.validate(args as unknown as JobGraphCreateInput | { graphId: string }) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'job.graph_status',
        title: 'Read job graph status',
        description: 'Returns graph and node-level dry-run status/progress for a persisted job graph.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', properties: { graphId: { type: 'string' } }, required: ['graphId'], additionalProperties: false },
      },
      handler: (args, { service }) => {
        if (typeof args.graphId !== 'string' || args.graphId.trim() === '') throw new Error('job.graph_status requires a non-empty graphId.');
        return service.jobGraphs.status(args.graphId);
      },
    },
    {
      definition: {
        name: 'job.graph_artifacts',
        title: 'Read job graph artifacts',
        description: 'Returns manifest, dry-run, and node artifact refs for a persisted job graph.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', properties: { graphId: { type: 'string' } }, required: ['graphId'], additionalProperties: false },
      },
      handler: (args, { service }) => {
        if (typeof args.graphId !== 'string' || args.graphId.trim() === '') throw new Error('job.graph_artifacts requires a non-empty graphId.');
        return service.jobGraphs.artifacts(args.graphId);
      },
    },
    {
      definition: {
        name: 'workflow.compose',
        title: 'Compose workflow graph',
        description: 'Builds a dry-run workflow DAG from a preset or supplied nodes without executing it.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => {
        const graph = service.workflows.compose(args as unknown as WorkflowComposeInput);
        return { ...graph, validation: service.workflows.validate(graph) } as unknown as JsonObject;
      },
    },
    {
      definition: {
        name: 'workflow.validate',
        title: 'Validate workflow',
        description: 'Validates a composed workflow or persisted graph for dependency and cycle errors.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.workflows.validate(args as unknown as WorkflowComposeInput | JobGraphCreateInput | { graphId: string }),
    },
    {
      definition: {
        name: 'workflow.dry_run',
        title: 'Dry-run workflow',
        description: 'Executes dependency ordering only and writes a dry-run artifact/ref; no extract, translate, apply, memory, or glossary mutation is performed.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.workflows.dryRun(args as unknown as WorkflowComposeInput | { graphId: string; ttlMs?: number }),
    },
    {
      definition: {
        name: 'workflow.explain',
        title: 'Explain workflow',
        description: 'Explains workflow order, limitations, and next suggested read-only calls.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.workflows.explain(args as unknown as WorkflowComposeInput | JobGraphCreateInput | { graphId: string }),
    },
    {
      definition: {
        name: 'workflow.save_recipe',
        title: 'Save workflow recipe',
        description: 'Saves a project-workspace recipe artifact/ref for a valid dry-run workflow graph.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: true },
      },
      handler: (args, { service }) => service.workflows.saveRecipe(args as unknown as { recipeId?: string; title?: string; workflow?: WorkflowComposeInput; graph?: JobGraphCreateInput; ttlMs?: number }) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'workflow.list_recipes',
        title: 'List workflow recipes',
        description: 'Lists saved workflow recipes and refs from the agent workspace.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { service }) => service.workflows.listRecipes(),
    },
    {
      definition: {
        name: 'help.translation_workflow',
        title: 'Agent translation workflow guide',
        description: 'Returns bounded guidance for first translation, review, safe apply, repair, recovery, and provider setup.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: () => createTranslationWorkflowPayload(),
    },
    {
      definition: {
        name: 'help.explain_tool',
        title: 'Explain read-only MCP tool',
        description: 'Explains a registered read-only MCP tool and its safe usage without executing it.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            toolName: { type: 'string' },
          },
          required: ['toolName'],
          additionalProperties: false,
        },
      },
      handler: (args) => {
        if (typeof args.toolName !== 'string' || args.toolName.trim() === '') {
          throw new Error('help.explain_tool requires a non-empty string toolName.');
        }
        return explainReadonlyTool(args.toolName, createReadonlyToolDefinitions().map((tool) => tool.definition));
      },
    },
    {
      definition: {
        name: 'help.safe_recipe',
        title: 'Safe agent recipe',
        description: 'Returns one safety-focused recipe by id for translation workflow guidance.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          properties: {
            recipeId: { type: 'string', enum: AGENT_SKILL_RECIPES.map((recipe) => recipe.id) },
          },
          required: ['recipeId'],
          additionalProperties: false,
        },
      },
      handler: (args) => {
        if (!isAgentSkillGuideTopic(args.recipeId)) {
          throw new Error(`help.safe_recipe requires recipeId to be one of: ${AGENT_SKILL_RECIPES.map((recipe) => recipe.id).join(', ')}.`);
        }
        return createSafeRecipePayload(args.recipeId);
      },
    },
  ];
}

function isAgentSkillGuideTopic(value: unknown): value is AgentSkillGuideTopic {
  return typeof value === 'string' && AGENT_SKILL_RECIPES.some((recipe) => recipe.id === value);
}

function requirePatchArg(args: JsonObject): TranslationPatch {
  if (!isPatchLike(args.patch)) throw new Error('patch.validate requires a patch object.');
  return args.patch as unknown as TranslationPatch;
}

function isPatchLike(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (value as { schemaVersion?: unknown }).schemaVersion === 1;
}

function sanitizeSettings(settings?: Partial<AppSettings> & Record<string, unknown>): JsonObject {
  if (!settings) {
    return {
      status: 'offline-placeholder',
      activeProvider: null,
      secretsRedacted: true,
      note: 'App settings are unavailable in offline MCP mode.',
    };
  }
  const sanitized: JsonObject = {};
  for (const [key, value] of Object.entries(settings)) {
    if ((LLM_PROVIDER_SECRET_SETTING_KEYS as readonly string[]).includes(key)) {
      sanitized[key] = typeof value === 'string' && value.trim() ? '[CONFIGURED_REDACTED]' : '';
    } else if (isJsonValue(value)) {
      sanitized[key] = value;
    }
  }
  const redacted = redactSecretLikeValues(sanitized);
  return { ...redacted.value, secretsRedacted: true, redactions: redacted.redactions };
}

function buildTranslationInventory(projectRoot: string, maxFiles: number): JsonObject {
  const inventory = {
    projectRoot,
    scannedFiles: 0,
    dataJsonFiles: [] as JsonObject[],
    extractedTextFiles: [] as JsonObject[],
    extractedMetadataFiles: [] as JsonObject[],
    warnings: [] as string[],
  };
  for (const filePath of walkFiles(projectRoot, maxFiles, inventory.warnings)) {
    const rel = path.relative(projectRoot, filePath);
    const stat = fs.statSync(filePath);
    const lower = path.basename(filePath).toLowerCase();
    if (lower.endsWith('.json') && (path.dirname(rel).toLowerCase().endsWith('data') || /^map\d{3}\.json$/i.test(lower))) {
      inventory.dataJsonFiles.push({ path: rel, sizeBytes: stat.size });
    } else if (lower.endsWith('.txt')) {
      inventory.extractedTextFiles.push({ path: rel, sizeBytes: stat.size, lineCount: countLinesBounded(filePath, 256 * 1024) });
    } else if (lower.endsWith('.extracteddata')) {
      inventory.extractedMetadataFiles.push({ path: rel, sizeBytes: stat.size });
    }
    inventory.scannedFiles += 1;
  }
  return inventory;
}

function reviewFile(service: AgentService, args: JsonObject): JsonObject {
  if (typeof args.path !== 'string' || args.path.trim() === '') {
    throw new Error('quality.review_file requires a non-empty string path.');
  }
  const read = service.files.readText(args.path, { maxBytes: numberArg(args.maxBytes, 64 * 1024) });
  const lines = read.text.split(/\r?\n/);
  const separatorLines = lines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter((entry) => /^-{3,}\s*[^-\r\n]{1,80}\s*-{3,}$/.test(entry.line));
  const controlCodeMatches = read.text.match(/\\{1,2}[A-Za-z]+(?:\[[^\]\r\n]{0,24}\])?|\\[{}$|.!<>^]/g) ?? [];
  const findings: JsonObject[] = [];
  if (!read.relativePath.toLowerCase().endsWith('.txt')) {
    findings.push({ severity: 'warning', code: 'non-text-extension', message: 'Review is optimized for extracted .txt files.' });
  }
  if (read.truncated) {
    findings.push({ severity: 'warning', code: 'truncated-read', message: 'File was read only up to the MCP maxBytes limit.' });
  }
  return {
    path: read.relativePath,
    lineCount: lines.length,
    emptyLineCount: lines.filter((line) => line === '').length,
    separatorLines,
    controlCodeCount: controlCodeMatches.length,
    findings,
    redactions: read.redactions,
  };
}

function latestHarnessArtifact(projectRoot: string): JsonObject {
  const harnessRoot = path.join(projectRoot, 'artifacts', 'harness');
  if (!fs.existsSync(harnessRoot)) return { status: 'missing', artifact: null };
  const candidates = walkFiles(harnessRoot, 200, [])
    .filter((filePath) => filePath.toLowerCase().endsWith('.json'))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  if (candidates.length === 0) return { status: 'missing', artifact: null };
  const latest = candidates[0];
  const parsed = JSON.parse(fs.readFileSync(latest.filePath, 'utf-8')) as JsonObject;
  const redacted = redactSecretLikeValues(parsed);
  return {
    status: 'ok',
    path: path.relative(projectRoot, latest.filePath),
    modifiedTimeMs: latest.stat.mtimeMs,
    artifact: redacted.value,
    redactions: redacted.redactions,
  };
}

function okEnvelope(requestId: string, toolName: string, permissionTier: PermissionTier, payload: JsonObject): AgentResultEnvelope {
  const redacted = redactSecretLikeValues(payload);
  const envelope: AgentResultEnvelope = {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'ok',
    permissionTier,
    payload: redacted.value,
    audit: [auditEntry(requestId, toolName, permissionTier, 'tool-call', `call ${toolName}`)],
    redactions: redacted.redactions,
  };
  if (typeof redacted.value.qualityScore === 'number') envelope.qualityScore = redacted.value.qualityScore;
  if (Array.isArray(redacted.value.nextSuggestedCalls)) envelope.nextSuggestedCalls = redacted.value.nextSuggestedCalls.filter((value): value is string => typeof value === 'string');
  return envelope;
}

function failureEnvelope(requestId: string, toolName: string, permissionTier: PermissionTier, message: string): AgentResultEnvelope {
  const redacted = redactSecretLikeValues({ message });
  return {
    schemaVersion: 1,
    requestId,
    toolName,
    status: 'failed',
    permissionTier,
    failure: {
      schemaVersion: 1,
      failureId: `failure-${requestId}`,
      requestId,
      stage: 'mcp-readonly-tool',
      message: String(redacted.value.message),
      retryable: false,
      createdAt: new Date().toISOString(),
    },
    audit: [auditEntry(requestId, toolName, permissionTier, 'failure', String(redacted.value.message))],
    redactions: redacted.redactions,
  };
}

function auditEntry(requestId: string, toolName: string, permissionTier: PermissionTier, kind: 'tool-call' | 'failure', action: string): AuditEntry {
  return {
    schemaVersion: 1,
    auditId: `audit-${requestId}`,
    timestamp: new Date().toISOString(),
    kind,
    actor: 'mcp',
    action,
    permissionTier,
    requestId,
    metadata: { toolName },
  };
}

function walkFiles(root: string, maxFiles: number, warnings: string[]): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const queue = [root];
  while (queue.length && result.length < maxFiles) {
    const current = queue.shift() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      if (entry.isFile()) result.push(fullPath);
      if (result.length >= maxFiles) {
        warnings.push(`Stopped scan at maxFiles ${maxFiles}.`);
        break;
      }
    }
  }
  return result;
}

function countLinesBounded(filePath: string, maxBytes: number): number {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(fs.statSync(filePath).size, maxBytes));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf-8').split(/\r?\n/).length;
  } finally {
    fs.closeSync(fd);
  }
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isJsonValue(value: unknown): value is JsonObject[string] {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value) || (typeof value === 'object' && value !== null);
}

function createRequestId(toolName: string): string {
  return `mcp-${Date.now()}-${toolName.replace(/[^a-z0-9_.-]/gi, '-')}`;
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
