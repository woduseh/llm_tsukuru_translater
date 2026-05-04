import type { JsonObject, McpToolDefinition } from '../types/agentWorkspace';

export type AgentSkillGuideTopic =
  | 'first_translation'
  | 'quality_review'
  | 'safe_apply'
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
  readonlyTools: string[];
  whenBlocked: string[];
}

export const AGENT_GUIDE_SAFETY_INVARIANTS = [
  'Preview before any run, apply, overwrite, or destructive operation.',
  'Never dump full source files, translated scripts, credentials, or provider secrets into prompts, logs, MCP responses, or terminal output.',
  'Preserve .txt line-number alignment with .extracteddata metadata.',
  'Preserve RPG Maker separators such as --- 101 ---, control codes, escape sequences, and intentional empty lines.',
  'Use read-only MCP context first; require explicit approval before future write or execute actions.',
];

export const AGENT_SKILL_RECIPES: AgentSkillRecipe[] = [
  {
    id: 'first_translation',
    title: 'First translation workflow',
    summary: 'Safely move from project context to extract, provider readiness, review, and apply preview.',
    prerequisites: ['A selected game project', 'A configured provider before live translation'],
    steps: [
      'Start with project.context_snapshot and project.translation_inventory to understand available data without file contents.',
      'Use provider.readiness before any translation request; if not ready, open provider setup instead of retrying blindly.',
      'Run extraction through the app UI and verify generated .txt and .extracteddata counts match expectations.',
      'Translate a small batch first, then use quality.review_file on representative extracted .txt files.',
      'Create an apply preview and review changed target paths before approving any write.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    readonlyTools: ['project.context_snapshot', 'project.translation_inventory', 'provider.readiness', 'quality.review_file'],
    whenBlocked: ['If no project is selected, choose an RPG Maker MV/MZ or Wolf project before starting.'],
  },
  {
    id: 'quality_review',
    title: 'Quality review',
    summary: 'Review translated text for structural safety before comparing or applying.',
    prerequisites: ['Extracted or translated .txt files'],
    steps: [
      'Use project.translation_inventory to locate candidate .txt and .extracteddata files.',
      'Use quality.review_file on sampled translated files to check separators, blank lines, and control-code counts.',
      'Open the compare window for human review of meaning, tone, placeholders, and suspicious omissions.',
      'Record findings as bounded summaries, not full file dumps.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    readonlyTools: ['project.translation_inventory', 'quality.review_file', 'project.get_quality_rules'],
    whenBlocked: ['If translated files are missing, complete extraction/translation first.'],
  },
  {
    id: 'safe_apply',
    title: 'Safe apply',
    summary: 'Prepare and review an apply operation without silently overwriting game data.',
    prerequisites: ['Translated .txt files', 'Matching .extracteddata metadata'],
    steps: [
      'Confirm inventory includes both translated text and .extracteddata metadata.',
      'Review quality rules and recent failures before preparing the apply preview.',
      'Generate a preview artifact that lists target files and expected write scope.',
      'Require explicit approval only after the user reviews the preview.',
      'After apply, run verification or compare checks before packaging changes.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    readonlyTools: ['project.translation_inventory', 'project.get_quality_rules', 'harness.latest'],
    whenBlocked: ['If metadata is missing or line counts drift, stop and use line-shift repair guidance.'],
  },
  {
    id: 'line_shift_repair',
    title: 'Line-shift repair',
    summary: 'Diagnose alignment drift without editing source data first.',
    prerequisites: ['A suspect translated .txt file and its .extracteddata metadata'],
    steps: [
      'Use quality.review_file to find separator, empty-line, and control-code anomalies.',
      'Compare nearby separators and line counts against the original extracted text.',
      'Restore deleted blank lines and separators before changing wording.',
      'Keep every metadata-bound text span on the original line range.',
      'Re-run review and compare before preparing any apply preview.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    readonlyTools: ['quality.review_file', 'project.get_quality_rules'],
    whenBlocked: ['If the correct line cannot be identified, stop and ask for human compare-window review.'],
  },
  {
    id: 'failed_translation_recovery',
    title: 'Failed translation recovery',
    summary: 'Resume safely after provider, network, or validation failure.',
    prerequisites: ['A failure artifact, harness artifact, or visible failed job'],
    steps: [
      'Inspect bounded failure summaries and harness.latest before retrying.',
      'Use provider.readiness to distinguish configuration failure from transient provider failure.',
      'Retry only the failed batch when possible; do not re-run a full project blindly.',
      'Preserve already verified output and keep secrets redacted from recovery notes.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    readonlyTools: ['provider.readiness', 'harness.latest', 'project.context_snapshot'],
    whenBlocked: ['If provider readiness is not ok, fix settings before retrying translation.'],
  },
  {
    id: 'provider_setup',
    title: 'Provider setup',
    summary: 'Guide users to configure an LLM provider without exposing credentials.',
    prerequisites: ['Provider account or local OpenAI-compatible endpoint'],
    steps: [
      'Use provider.list to choose a supported provider and model.',
      'Open settings and enter credentials only in the app settings UI.',
      'Use provider.readiness to check sanitized readiness; never echo API keys into chat or terminal.',
      'Run a small translation sample before starting a large batch.',
    ],
    safety: AGENT_GUIDE_SAFETY_INVARIANTS,
    readonlyTools: ['provider.list', 'provider.readiness', 'settings.get_sanitized'],
    whenBlocked: ['If settings are unavailable in offline MCP mode, show provider setup instructions instead of attempting live calls.'],
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
    'Use this guide as safe operating instructions for agent-assisted translation workflows.',
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
      `Read-only tools: ${recipe.readonlyTools.join(', ')}`,
    ]),
  ].join('\n');
}

export function createSafeRecipePayload(id: AgentSkillGuideTopic): JsonObject {
  const recipe = getAgentSkillRecipe(id);
  return {
    recipe: recipe as unknown as JsonObject,
    safetyInvariants: [...AGENT_GUIDE_SAFETY_INVARIANTS],
    noAutoRun: true,
    approvalRequiredBeforeWrite: true,
  };
}

export function createTranslationWorkflowPayload(): JsonObject {
  return {
    guide: 'Agent-assisted translation should progress through context, inventory, provider readiness, small-batch translation, quality review, compare, apply preview, approval, and verification.',
    guideText: createAgentGuideText(),
    recipes: AGENT_SKILL_RECIPES.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      summary: recipe.summary,
      readonlyTools: recipe.readonlyTools,
    })),
    safetyInvariants: [...AGENT_GUIDE_SAFETY_INVARIANTS],
  };
}

export function explainReadonlyTool(toolName: string, definitions: McpToolDefinition[]): JsonObject {
  const definition = definitions.find((tool) => tool.name === toolName);
  if (!definition) {
    return {
      status: 'unknown',
      toolName,
      message: `No read-only MCP tool named ${toolName} is registered.`,
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
    safety: 'This tool is read-only and must not return full source dumps or secrets.',
  };
}

