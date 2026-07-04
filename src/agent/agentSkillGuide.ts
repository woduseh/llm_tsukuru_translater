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
  prerequisites: string[];
  steps: string[];
  safety: string[];
  tools: string[];
  whenBlocked: string[];
}

export const AGENT_GUIDE_SAFETY_INVARIANTS = [
  'MCP tools may write analysis artifacts only under .llm-tsukuru-agent; they must not modify game or translation source files.',
  'Run translation and apply actions through the app UI, not through this MCP server.',
  'Never dump full source files, translated scripts, credentials, or provider secrets into prompts, logs, MCP responses, or terminal output.',
  'Preserve .txt line-number alignment with .extracteddata metadata.',
  'Preserve RPG Maker separators such as --- 101 ---, control codes, escape sequences, and intentional empty lines.',
];

export const AGENT_SKILL_RECIPES: AgentSkillRecipe[] = [
  {
    id: 'first_translation',
    title: 'Translation preflight',
    summary: 'Inspect project context and translation inputs before running translation in the app UI.',
    prerequisites: ['A selected game project'],
    steps: [
      'Start with project.context_snapshot and project.translation_inventory to understand available inputs without dumping file contents.',
      'Use provider.list to explain supported providers; direct the user to the app settings UI for credentials and readiness.',
      'Run extraction and translation through the app UI.',
      'After a small app-run batch, inspect representative files with quality.review_file or qa.score_file.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    tools: ['project.context_snapshot', 'project.translation_inventory', 'provider.list', 'quality.review_file', 'qa.score_file'],
    whenBlocked: ['If no project is selected, choose an RPG Maker MV/MZ or Wolf project before starting.'],
  },
  {
    id: 'quality_review',
    title: 'Quality review',
    summary: 'Review translated text for structural safety without modifying source files.',
    prerequisites: ['Extracted or translated .txt files'],
    steps: [
      'Use project.translation_inventory to locate candidate .txt and .extracteddata files.',
      'Use quality.review_file for a bounded, non-persistent review.',
      'Use qa.score_file when a durable QA artifact under .llm-tsukuru-agent is useful.',
      'Open the compare window for human review of meaning, tone, placeholders, and suspicious omissions.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    tools: ['project.translation_inventory', 'quality.review_file', 'qa.score_file', 'project.get_quality_rules'],
    whenBlocked: ['If translated files are missing, complete extraction and translation in the app first.'],
  },
  {
    id: 'line_shift_repair',
    title: 'Line-shift diagnosis',
    summary: 'Diagnose alignment drift and leave the source files untouched.',
    prerequisites: ['A suspect translated .txt file and its source text or .extracteddata metadata'],
    steps: [
      'Use quality.review_file to find separator, empty-line, and control-code anomalies.',
      'Use alignment.inspect to create a bounded alignment artifact in .llm-tsukuru-agent.',
      'Summarize the affected lines and stop before changing source or translated files.',
      'Use the app compare and verification surfaces for human review.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    tools: ['quality.review_file', 'alignment.inspect', 'alignment.explain', 'project.get_quality_rules'],
    whenBlocked: ['If the correct alignment cannot be proved, stop and ask for human compare-window review.'],
  },
  {
    id: 'failed_translation_recovery',
    title: 'Failed translation recovery',
    summary: 'Collect bounded project evidence before retrying a failed app translation.',
    prerequisites: ['A visible app failure or affected translation batch'],
    steps: [
      'Inspect project.context_snapshot and project.translation_inventory.',
      'Review only representative failed files with quality.review_file.',
      'Check provider configuration in the app settings UI without echoing credentials.',
      'Retry only the failed batch from the app when possible.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    tools: ['project.context_snapshot', 'project.translation_inventory', 'quality.review_file'],
    whenBlocked: ['If provider readiness is unknown, return to app settings instead of guessing from offline MCP data.'],
  },
  {
    id: 'provider_setup',
    title: 'Provider setup',
    summary: 'Explain available providers while keeping credentials inside the app settings UI.',
    prerequisites: ['Provider account or local OpenAI-compatible endpoint'],
    steps: [
      'Use provider.list to choose a supported provider and model.',
      'Open app settings and enter credentials only in the app settings UI.',
      'Confirm readiness in the app UI.',
      'Run a small translation sample in the app before starting a large batch.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    tools: ['provider.list'],
    whenBlocked: ['If configuration is incomplete, stay in the app settings flow and do not request secrets in chat or terminal.'],
  },
];

export function getAgentSkillRecipe(id: AgentSkillGuideTopic): AgentSkillRecipe {
  const recipe = AGENT_SKILL_RECIPES.find((candidate) => candidate.id === id);
  if (!recipe) throw new Error(`Unknown agent skill recipe: ${id}`);
  return recipe;
}

export function createAgentGuideText(): string {
  return [
    '# Agent MCP Guide',
    '',
    'Use MCP for project analysis. Run translation and apply through the app UI.',
    '',
    '## Safety invariants',
    ...AGENT_GUIDE_SAFETY_INVARIANTS.map((item) => `- ${item}`),
    '',
    '## Recipes',
    ...AGENT_SKILL_RECIPES.flatMap((recipe) => [
      '',
      `### ${recipe.title}`,
      recipe.summary,
      '',
      'Steps:',
      ...recipe.steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      `Tools: ${recipe.tools.join(', ')}`,
    ]),
  ].join('\n');
}

export function createSafeRecipePayload(id: AgentSkillGuideTopic): JsonObject {
  const recipe = getAgentSkillRecipe(id);
  return {
    recipe: recipe as unknown as JsonObject,
    safetyInvariants: [...AGENT_GUIDE_SAFETY_INVARIANTS],
    noAutoRun: true,
    projectFilesProtected: true,
    workspaceWritesPossible: recipe.tools.some((tool) => [
      'qa.score_file',
      'alignment.inspect',
      'alignment.explain',
    ].includes(tool)),
  };
}

export function createTranslationWorkflowPayload(): JsonObject {
  return {
    guide: 'Use MCP to inspect context and quality, then run translation and apply through the app UI.',
    guideText: createAgentGuideText(),
    recipes: AGENT_SKILL_RECIPES.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      summary: recipe.summary,
      tools: recipe.tools,
    })),
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
  return {
    status: 'ok',
    toolName: definition.name,
    title: definition.title,
    description: definition.description,
    permissionTier: definition.permissionTier,
    inputSchema: definition.inputSchema,
    safety: definition.permissionTier === 'readonly'
      ? 'This tool does not write files.'
      : 'This tool may write analysis state under .llm-tsukuru-agent but must not modify project source files.',
  };
}
