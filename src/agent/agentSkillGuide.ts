import type { JsonObject, McpToolDefinition } from '../types/agentWorkspace';

export type AgentSkillGuideTopic =
  | 'first_translation'
  | 'quality_review'
  | 'line_shift_repair'
  | 'failed_translation_recovery'
  | 'provider_setup';

export interface AgentSkillRecipe {
  id: AgentSkillGuideTopic;
  title: string;
  summary: string;
  tools: string[];
}

export const AGENT_GUIDE_SAFETY_INVARIANTS = [
  'Preserve .txt line-number alignment with .extracteddata, separators such as --- 101 ---, control codes, and intentional empty lines.',
  'Use source excerpts needed for the task; keep credentials and provider secrets out of chat, logs, and artifacts.',
];

export const AGENT_SKILL_RECIPES: AgentSkillRecipe[] = [
  {
    id: 'first_translation',
    title: 'Translation preflight',
    summary: 'Inspect available translation inputs. Extraction and provider translation run in the app UI.',
    tools: ['project.context_snapshot', 'project.translation_inventory', 'provider.list'],
  },
  {
    id: 'quality_review',
    title: 'Quality review',
    summary: 'quality.review_file reports structural counts and read limits; qa.score_file saves a QA artifact. Use source and translation evidence to assess meaning and tone; compare and verification windows support visual review.',
    tools: ['quality.review_file', 'qa.score_file', 'project.get_quality_rules'],
  },
  {
    id: 'line_shift_repair',
    title: 'Line-shift diagnosis and proposal',
    summary: 'Inspect alignment evidence before proposing replacements. If alignment remains ambiguous, identify the missing evidence instead of guessing line mappings.',
    tools: ['alignment.inspect', 'alignment.explain', 'patch.propose', 'patch.validate'],
  },
  {
    id: 'failed_translation_recovery',
    title: 'Failed translation recovery',
    summary: 'Use affected-file evidence to isolate the failure; retry the affected batch in the app. Offline MCP data cannot establish live provider readiness.',
    tools: ['project.context_snapshot', 'project.translation_inventory', 'quality.review_file'],
  },
  {
    id: 'provider_setup',
    title: 'Provider setup',
    summary: 'provider.list describes supported providers. Configure credentials and check readiness in app settings; enter credentials only in the app settings UI.',
    tools: ['provider.list'],
  },
];

export function getAgentSkillRecipe(id: AgentSkillGuideTopic): AgentSkillRecipe {
  const recipe = AGENT_SKILL_RECIPES.find((candidate) => candidate.id === id);
  if (!recipe) throw new Error(`Unknown agent skill recipe: ${id}`);
  return recipe;
}

function capabilities(definitions: McpToolDefinition[]): JsonObject {
  const bridgeRegistered = definitions.some((tool) => tool.name === 'patch.apply');
  return {
    mode: bridgeRegistered ? 'app-bridge' : 'offline',
    analysisWrites: 'Workspace-write tools save analysis artifacts under .llm-tsukuru-agent.',
    execution: bridgeRegistered
      ? 'Extraction and provider translation run in the app UI. patch.apply submits a bounded translation patch for app approval; approval.status reads its result. Registration does not establish a live connection: bridge calls can fail when the app is unavailable or the manifest is stale.'
      : 'Run translation and apply through the app UI. Offline MCP can analyze files and prepare patch proposals, but cannot apply them.',
  };
}

function recipePayload(recipe: AgentSkillRecipe, definitions: McpToolDefinition[]): JsonObject {
  const available = new Set(definitions.map((tool) => tool.name));
  const candidates = recipe.id === 'line_shift_repair'
    ? [...recipe.tools, 'patch.apply', 'approval.status']
    : recipe.tools;
  return { ...recipe, tools: candidates.filter((tool) => available.has(tool)) };
}

export function createSafeRecipePayload(id: AgentSkillGuideTopic, definitions: McpToolDefinition[]): JsonObject {
  return {
    recipe: recipePayload(getAgentSkillRecipe(id), definitions),
    capabilities: capabilities(definitions),
    safetyInvariants: [...AGENT_GUIDE_SAFETY_INVARIANTS],
  };
}

export function createTranslationWorkflowPayload(definitions: McpToolDefinition[]): JsonObject {
  return {
    capabilities: capabilities(definitions),
    recipes: AGENT_SKILL_RECIPES.map((recipe) => recipePayload(recipe, definitions)),
    safetyInvariants: [...AGENT_GUIDE_SAFETY_INVARIANTS],
  };
}

export function explainTool(toolName: string, definitions: McpToolDefinition[]): JsonObject {
  const definition = definitions.find((tool) => tool.name === toolName);
  if (!definition) {
    return {
      status: 'unknown',
      toolName,
      message: `No MCP tool named ${toolName} is registered.`,
      availableTools: definitions.map((tool) => tool.name),
    };
  }
  const safetyByTier = {
    readonly: 'This tool does not write files.',
    'workspace-write': 'This tool writes analysis state under .llm-tsukuru-agent, not project source files.',
    'approval-required': 'This tool requests app approval; submission does not apply the patch. Inspect approval.status for the outcome.',
    dangerous: 'Check the tool description for its effects and authorization requirements.',
  };
  return {
    status: 'ok',
    toolName: definition.name,
    title: definition.title,
    description: definition.description,
    permissionTier: definition.permissionTier,
    inputSchema: definition.inputSchema,
    safety: safetyByTier[definition.permissionTier],
  };
}
