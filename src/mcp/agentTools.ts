import type { GlossarySearchOptions } from '../agent/glossaryService';
import type { MemorySearchOptions } from '../agent/memoryService';
import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_SKILL_RECIPES,
  createSafeRecipePayload,
  createTranslationWorkflowPayload,
  explainTool,
  type AgentSkillGuideTopic,
} from '../agent/agentSkillGuide';
import { listProviderRegistryEntries } from '../ts/libs/providerRegistry';
import type { TranslationPatch } from '../types/agentWorkspace';
import { buildTranslationInventory } from './projectInventory';
import type { RegisteredMcpTool } from './readonlyTools';
import type { JsonObject } from '../types/agentWorkspace';
import { TranslationReadService } from '../agent/translationReadService';
import type { TranslationPatchOperation } from '../types/agentWorkspace';

const text = (description: string, maxLength = 1024): JsonObject => ({
  type: 'string',
  minLength: 1,
  maxLength,
  description,
});
const integer = (description: string, minimum: number, maximum: number, defaultValue: number): JsonObject => ({
  type: 'integer',
  minimum,
  maximum,
  default: defaultValue,
  description,
});
const object = (properties: JsonObject, required: string[] = []): JsonObject => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const targetPath = text(
  'Translation .txt path relative to the selected game project. Use project.translation_inventory to discover paths.',
);
const sourcePath = text(
  'Original extracted .txt path relative to the same project. Do not guess source/translation pairings.',
);
const count = integer('Number of complete lines to return. Reduce for long lines.', 1, 200, 40);
const startLine = integer('One-based physical line number, including separators and empty lines.', 1, 10000000, 1);
const inspection = {
  sourcePath,
  targetPath,
  metadataPath: text('Optional extraction metadata path; metadata availability does not prove semantic alignment.'),
  maxBytes: integer(
    'Maximum bytes inspected per file. A partial read is never verified.',
    1,
    8 * 1024 * 1024,
    256 * 1024,
  ),
};

export const PATCH_VALIDATE_INPUT_SCHEMA: JsonObject = {
  type: 'object',
  properties: {
    patch: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'number', enum: [1] },
        patchId: { type: 'string' },
        createdAt: { type: 'string' },
        dryRunOnly: { type: 'boolean', enum: [true] },
        targetPath: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              opId: { type: 'string' },
              kind: { type: 'string', enum: ['replace-line', 'virtual-note'] },
              targetPath: { type: 'string' },
              lineNumber: { type: 'number' },
              originalText: { type: 'string' },
              replacementText: { type: 'string' },
              note: { type: 'string' },
              alignmentProofRef: { type: 'string' },
            },
            required: ['opId', 'kind', 'targetPath', 'lineNumber'],
            additionalProperties: false,
          },
        },
        alignmentRef: { type: 'string' },
        invariantPolicy: {
          type: 'object',
          properties: {
            preserveLineCount: { type: 'boolean', enum: [true] },
            requiresAlignmentProofForLineCountChange: { type: 'boolean', enum: [true] },
          },
          required: ['preserveLineCount', 'requiresAlignmentProofForLineCountChange'],
          additionalProperties: false,
        },
      },
      required: ['schemaVersion', 'patchId', 'createdAt', 'dryRunOnly', 'targetPath', 'operations', 'invariantPolicy'],
      additionalProperties: false,
    },
  },
  required: ['patch'],
  additionalProperties: false,
};

/** The complete public offline surface; no hidden legacy registry or simulation tools. */
export function createAgentToolDefinitions(): RegisteredMcpTool[] {
  return [
    {
      definition: {
        name: 'project.context_snapshot',
        title: 'Project context snapshot',
        description: 'Returns bounded project, workspace, job, and MCP tool context without file contents.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { service, toolDefinitions }) => {
        const refreshed = service.refreshManifest();
        return toJsonObject({
          projectRoot: refreshed.projectRoot,
          workspaceRoot: refreshed.workspaceRoot,
          manifestPath: path.relative(refreshed.projectRoot, refreshed.manifestPath),
          engine: refreshed.manifest.engine,
          currentJobs: refreshed.manifest.currentJobs,
          lastFailures: refreshed.manifest.lastFailures,
          availableTools: toolDefinitions.map((tool) => ({
            name: tool.name,
            permissionTier: tool.permissionTier,
          })),
        });
      },
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
        description:
          'Discover game data, extracted originals and translations by path. File names do not establish source/target pairing. Limited scans report warnings.',
        permissionTier: 'readonly',
        inputSchema: object({
          maxFiles: integer('Maximum scanned files; inspect warnings for incomplete inventory.', 1, 2000, 500),
        }),
      },
      handler: (args, { service }) =>
        buildTranslationInventory(service.descriptor.projectRoot, numberArg(args.maxFiles, 500)),
    },
    {
      definition: {
        name: 'artifacts.read_ref',
        title: 'Read data or artifact ref',
        description:
          'Read a saved analysis result by reference. Returns valid JSON pages, never a truncated JSON string. Reuse references rather than rerunning inspection.',
        permissionTier: 'readonly',
        inputSchema: object(
          {
            refId: text('Artifact refId returned by this project.'),
            collection: {
              type: 'string',
              enum: ['summary', 'refs', 'breaks', 'findings', 'operations'],
              default: 'summary',
              description: 'Collection to page. summary omits array contents.',
            },
            offset: integer('Zero-based offset into the selected collection.', 0, 10000000, 0),
            limit: integer('Maximum items. The byte budget may return fewer; follow nextOffset.', 1, 100, 20),
          },
          ['refId'],
        ),
      },
      handler: (args, { service }) =>
        service.dataRefs.readPage(args.refId as string, {
          collection: args.collection as string | undefined,
          offset: args.offset as number | undefined,
          limit: args.limit as number | undefined,
        }),
    },
    {
      definition: {
        name: 'alignment.inspect',
        title: 'Inspect translation alignment',
        description:
          'Inspect structural alignment of an original/translation pair. Returns coverage, score, top breaks and a paginated artifact ref; never assesses meaning. Partial coverage cannot establish correctness.',
        permissionTier: 'workspace-write',
        inputSchema: object(inspection, ['sourcePath', 'targetPath']),
      },
      handler: (args, { service }) => {
        const result = service.alignment.inspect(args as unknown as Parameters<typeof service.alignment.inspect>[0]);
        const { refs, breaks, ...summary } = result;
        return json({
          ...summary,
          breaks: breaks.slice(0, 20),
          breakCount: breaks.length,
          refCount: refs.length,
          details: { tool: 'artifacts.read_ref', refId: result.alignmentRef?.refId, collection: 'breaks' },
        });
      },
    },
    {
      definition: {
        name: 'qa.score_file',
        title: 'Score translated file QA',
        description:
          'Inspect one original/translation pair for deterministic structural and heuristic issues. Returns a structural gate, coverage and top findings, not a semantic translation rating. Read affected lines with translation.read_window.',
        permissionTier: 'workspace-write',
        inputSchema: object(inspection, ['sourcePath', 'targetPath']),
      },
      handler: (args, { service }) => {
        const result = service.qa.scoreFile(args as unknown as Parameters<typeof service.qa.scoreFile>[0]);
        const gate = service.qa.thresholdGate({ score: result });
        const { findings, qualityScore, nextSuggestedCalls: _next, ...summary } = result;
        void _next;
        return json({
          ...summary,
          structuralScore: qualityScore,
          gate: gate.gate,
          semanticQuality: 'not-evaluated',
          findings: findings.slice(0, 20),
          findingCount: findings.length,
          nextSuggestedCalls: findings.length ? ['translation.read_window', 'patch.propose'] : [],
          details: { tool: 'artifacts.read_ref', refId: result.qaRef?.refId, collection: 'findings' },
        });
      },
    },
    {
      definition: {
        name: 'patch.propose',
        title: 'Propose dry-run translation patch',
        description:
          'Prepare and validate up to 100 same-line replacements in one UTF-8 .txt file (256 KiB maximum). Returns patch plus before/after preview. Does not submit or apply. Re-read and regenerate if original text changed.',
        permissionTier: 'workspace-write',
        inputSchema: object(
          {
            targetPath,
            operations: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              description:
                'Same-line replacements only. Read current text first. Original text is a concurrency precondition.',
              items: object(
                {
                  lineNumber: { ...startLine, description: 'One-based target line to replace.' },
                  originalText: {
                    type: 'string',
                    maxLength: 8192,
                    description:
                      'Exact current complete line from translation.read_window; never use redacted or clipped text.',
                  },
                  replacementText: {
                    type: 'string',
                    maxLength: 8192,
                    description:
                      'Complete replacement line without newline. Preserve empty-line state, separator and ordered control codes.',
                  },
                },
                ['lineNumber', 'originalText', 'replacementText'],
              ),
            },
          },
          ['targetPath', 'operations'],
        ),
      },
      handler: (args, { service }) => {
        const operations = (args.operations as JsonObject[]).map((op, i) => ({
          ...op,
          opId: `op-${i + 1}`,
          kind: 'replace-line',
          targetPath: args.targetPath,
        })) as unknown as TranslationPatchOperation[];
        const proposal = service.patch.propose({ targetPath: args.targetPath as string, operations });
        return json({
          ...proposal,
          preview: service.patch.preview(proposal.patch),
          nextTool: proposal.validation.valid ? 'patch.apply (app bridge only)' : 'translation.read_window',
        });
      },
    },
    {
      definition: {
        name: 'patch.validate',
        title: 'Validate translation patch invariants',
        description:
          'Validates dry-run patch invariants, rejecting line-count-changing replacements unless a future alignment proof protocol is implemented.',
        permissionTier: 'readonly',
        inputSchema: PATCH_VALIDATE_INPUT_SCHEMA,
      },
      handler: (args, { service }) => service.patch.validate(requirePatchArg(args)) as unknown as JsonObject,
    },
    {
      definition: {
        name: 'glossary.search',
        title: 'Search project glossary',
        description: 'Searches project-local glossary entries without writing project files.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          required: [],
          properties: {
            query: { type: 'string' },
            engineType: { type: 'string' },
            speaker: { type: 'string' },
            minConfidence: { type: 'number' },
            limit: integer('Maximum results.', 1, 50, 20),
          },
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => ({
        entries: service.glossary.search(args as unknown as GlossarySearchOptions) as unknown as JsonObject[],
      }),
    },
    {
      definition: {
        name: 'memory.search',
        title: 'Search project agent memory',
        description: 'Searches project-local agent memory entries without writing project files.',
        permissionTier: 'readonly',
        inputSchema: {
          type: 'object',
          required: [],
          properties: {
            query: { type: 'string' },
            type: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            includeForgotten: { type: 'boolean' },
            minConfidence: { type: 'number' },
            limit: integer('Maximum results.', 1, 50, 20),
          },
          additionalProperties: false,
        },
      },
      handler: (args, { service }) => ({
        entries: service.memory.search(args as unknown as MemorySearchOptions) as unknown as JsonObject[],
      }),
    },
    {
      definition: {
        name: 'help.translation_workflow',
        title: 'Agent translation workflow guide',
        description:
          'Returns bounded guidance for project analysis, app-run translation, quality review, recovery, and provider setup.',
        permissionTier: 'readonly',
        inputSchema: { type: 'object', additionalProperties: false },
      },
      handler: (_args, { toolDefinitions }) => createTranslationWorkflowPayload(toolDefinitions),
    },
    {
      definition: {
        name: 'help.explain_tool',
        title: 'Explain MCP tool',
        description: 'Explains a registered MCP tool, its permission tier, and its safe usage without executing it.',
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
      handler: (args, { toolDefinitions }) => {
        if (typeof args.toolName !== 'string' || args.toolName.trim() === '') {
          throw new Error('help.explain_tool requires a non-empty string toolName.');
        }
        return explainTool(args.toolName, toolDefinitions);
      },
    },
    {
      definition: {
        name: 'help.safe_recipe',
        title: 'Safe agent recipe',
        description: 'Returns task-specific capabilities and constraints by recipe id.',
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
      handler: (args, { toolDefinitions }) => {
        if (!isAgentSkillGuideTopic(args.recipeId)) {
          throw new Error(
            `help.safe_recipe requires recipeId to be one of: ${AGENT_SKILL_RECIPES.map((recipe) => recipe.id).join(', ')}.`,
          );
        }
        return createSafeRecipePayload(args.recipeId, toolDefinitions);
      },
    },
    {
      definition: {
        name: 'translation.read_window',
        title: 'translation.read_window',
        description:
          'Read complete numbered translation lines and optional original lines at the same positions, including empty lines and control codes. Returns file hashes and redaction status. Position pairing is not proof of alignment. Read this before editing or judging meaning.',
        permissionTier: 'readonly',
        inputSchema: object({ targetPath, sourcePath, startLine, count }, ['targetPath']),
      },
      handler: (args, { service }) =>
        new TranslationReadService({ projectRoot: service.descriptor.projectRoot }).readWindow(
          args as unknown as Parameters<TranslationReadService['readWindow']>[0],
        ),
    },
    {
      definition: {
        name: 'translation.search',
        title: 'translation.search',
        description:
          'Find literal text in known project text files. Returns bounded matches and continuation arguments. Use inventory to choose paths; use read_window for complete context.',
        permissionTier: 'readonly',
        inputSchema: object(
          {
            paths: { type: 'array', minItems: 1, maxItems: 20, items: targetPath },
            query: text('Literal text to find, not a regular expression.', 500),
            startLine,
            limit: integer('Maximum matches per response.', 1, 100, 20),
          },
          ['paths', 'query'],
        ),
      },
      handler: (args, { service }) =>
        new TranslationReadService({ projectRoot: service.descriptor.projectRoot }).search(
          args as unknown as Parameters<TranslationReadService['search']>[0],
        ),
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
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
