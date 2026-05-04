import axios from 'axios';
import type { AppSettings, LlmProvider } from '../../types/settings';
import { DEFAULT_LLM_VERTEX_LOCATION } from '../../types/settings';
import { DEFAULT_API_TIMEOUT_SEC } from './constants';
import {
  buildChatCompletionsUrl,
  OPENAI_BASE_URL,
} from './openAiCompatibleTranslator';
import {
  ANTHROPIC_VERSION,
  CLAUDE_MESSAGES_URL,
} from './claudeTranslator';
import {
  buildVertexApiUrl,
  createVertexAccessTokenProvider,
} from './vertexTranslator';
import { parseVertexServiceAccountJson } from './vertexCredentials';
import { assertLlmReady, normalizeLlmProvider } from './translatorFactory';
import { getLanguageName, stripMarkdownFences } from './translationPrompt';
import type {
  ProjectProfilePattern,
  ProjectProfileSample,
  ProjectTranslationProfile,
} from './projectProfile';

const DEFAULT_MAX_PROMPT_CHARS = 12000;
const DEFAULT_MAX_ITEMS_PER_BUCKET = 12;
const DEFAULT_MAX_TEXT_LENGTH = 80;

export const GUIDELINE_FIXED_FORMAT_RULES = `## Non-negotiable Format Rules

- Preserve dialogue separators exactly as-is, including lines like \`--- 101 ---\`; never translate, renumber, remove, or add them.
- Preserve RPG Maker/Wolf control codes exactly as-is, including patterns like \`\\\\V[1]\`, \`\\\\N[2]\`, \`\\\\C[3]\`, \`\\\\G\`, \`\\\\$\`, \`\\\\{\`, \`\\\\}\`, and similar escape sequences.
- Preserve empty lines exactly. Do not fill, delete, trim away, or insert blank lines.
- Preserve the source line count and line order for every translated block so extracted .txt files stay aligned with .extracteddata metadata.
- Preserve HTML/XML tags, placeholders, variables, and punctuation-only structural lines; translate only human-readable text around them.`;

export interface GuidelineGenerationOptions {
  sourceLang: string;
  targetLang: string;
  existingCustomPrompt?: string;
  maxPromptChars?: number;
  maxItemsPerBucket?: number;
  maxTextLength?: number;
  isAborted?: () => boolean;
  providerClient?: GuidelineProviderClient;
}

export interface GuidelineGenerationResult {
  guideline: string;
  providerDraft: string;
  boundedProfile: BoundedGuidelineProfile;
  promptChars: number;
}

export interface GuidelineProviderClient {
  generate(args: {
    settings: Partial<AppSettings>;
    provider: LlmProvider;
    systemPrompt: string;
    userPrompt: string;
    isAborted?: () => boolean;
  }): Promise<string>;
}

export interface BoundedGuidelineProfile {
  schemaVersion: 1;
  rootName: string;
  fileStats: {
    totalFiles: number;
    scannedFiles: number;
    skippedFiles: number;
    byExtension: Record<string, number>;
    byKind: ProjectTranslationProfile['fileStats']['byKind'];
  };
  languageHints: ProjectTranslationProfile['languageHints'];
  terms: ProjectProfileSample[];
  names: ProjectProfileSample[];
  repeatedPhrases: ProjectProfileSample[];
  characterCandidates: ProjectProfileSample[];
  controlCodePatterns: ProjectProfilePattern[];
  separatorPatterns: ProjectProfilePattern[];
  warnings: string[];
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function boundSamples(samples: ProjectProfileSample[], maxItems: number, maxTextLength: number): ProjectProfileSample[] {
  return samples.slice(0, maxItems).map((sample) => ({
    text: truncateText(sample.text, maxTextLength),
    count: sample.count,
    files: sample.files.slice(0, 3),
  }));
}

function boundPatterns(patterns: ProjectProfilePattern[], maxItems: number, maxTextLength: number): ProjectProfilePattern[] {
  return patterns.slice(0, maxItems).map((pattern) => ({
    pattern: truncateText(pattern.pattern, maxTextLength),
    count: pattern.count,
    files: pattern.files.slice(0, 3),
    examples: pattern.examples.slice(0, 3).map((example) => truncateText(example, maxTextLength)),
  }));
}

export function buildBoundedGuidelineProfile(
  profile: ProjectTranslationProfile,
  options: Pick<GuidelineGenerationOptions, 'maxItemsPerBucket' | 'maxTextLength'> = {},
): BoundedGuidelineProfile {
  const maxItems = options.maxItemsPerBucket ?? DEFAULT_MAX_ITEMS_PER_BUCKET;
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;

  return {
    schemaVersion: 1,
    rootName: truncateText(profile.rootName, maxTextLength),
    fileStats: {
      totalFiles: profile.fileStats.totalFiles,
      scannedFiles: profile.fileStats.scannedFiles,
      skippedFiles: profile.fileStats.skippedFiles,
      byExtension: profile.fileStats.byExtension,
      byKind: profile.fileStats.byKind,
    },
    languageHints: profile.languageHints,
    terms: boundSamples(profile.terms, maxItems, maxTextLength),
    names: boundSamples(profile.names, maxItems, maxTextLength),
    repeatedPhrases: boundSamples(profile.repeatedPhrases, maxItems, maxTextLength),
    characterCandidates: boundSamples(profile.characterCandidates, maxItems, maxTextLength),
    controlCodePatterns: boundPatterns(profile.controlCodePatterns, maxItems, maxTextLength),
    separatorPatterns: boundPatterns(profile.separatorPatterns, maxItems, maxTextLength),
    warnings: profile.warnings.slice(0, maxItems).map((warning) => truncateText(warning, maxTextLength * 2)),
  };
}

export function buildGuidelineGenerationPrompts(
  profile: ProjectTranslationProfile,
  options: GuidelineGenerationOptions,
): { systemPrompt: string; userPrompt: string; boundedProfile: BoundedGuidelineProfile; promptChars: number } {
  const sourceLangName = getLanguageName(options.sourceLang);
  const targetLangName = getLanguageName(options.targetLang);
  const boundedProfile = buildBoundedGuidelineProfile(profile, options);
  const profileJson = JSON.stringify(boundedProfile, null, 2);
  const existingPrompt = truncateText(options.existingCustomPrompt || '', 1200);

  const systemPrompt = [
    'You create concise RPG game localization guidelines from a bounded project profile.',
    'Do not ask for or infer from full project text. Use only the profile JSON provided by the user.',
    `Write guidance for translating from ${sourceLangName} to ${targetLangName}.`,
    'Return useful instructions that can be pasted into a translator system prompt.',
    'Do not include markdown code fences or commentary about privacy/cost.',
  ].join('\n');

  let userPrompt = [
    `Source language: ${sourceLangName}`,
    `Target language: ${targetLangName}`,
    '',
    'Existing custom prompt excerpt, if any:',
    existingPrompt || '(none)',
    '',
    'Bounded project translation profile JSON:',
    profileJson,
    '',
    'Draft these sections only:',
    '## Project-Specific Style Guidance',
    '## Terminology and Names',
    '## Character Voice Hints',
    '## Ambiguities to Review Manually',
    '',
    'Keep it under 900 words. Mention only terms, names, patterns, and risks supported by the profile.',
  ].join('\n');

  const maxPromptChars = options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  if (systemPrompt.length + userPrompt.length > maxPromptChars) {
    const allowedUserChars = Math.max(1000, maxPromptChars - systemPrompt.length);
    userPrompt = `${userPrompt.slice(0, allowedUserChars)}\n\n[Profile truncated to configured prompt budget.]`;
  }

  return {
    systemPrompt,
    userPrompt,
    boundedProfile,
    promptChars: systemPrompt.length + userPrompt.length,
  };
}

export function composeGuidelineDraft(providerDraft: string): string {
  const cleanedDraft = stripMarkdownFences(providerDraft).trim();
  return cleanedDraft
    ? `${GUIDELINE_FIXED_FORMAT_RULES}\n\n${cleanedDraft}`
    : GUIDELINE_FIXED_FORMAT_RULES;
}

function getTimeout(settings: Partial<AppSettings>): number {
  return (settings.llmTimeout || DEFAULT_API_TIMEOUT_SEC) * 1000;
}

function getGeminiApiUrl(model: string): string {
  const modelPath = model.includes('/') ? model : `models/${model}`;
  return `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
}

function getApiText(response: unknown, provider: LlmProvider): string {
  if (provider === 'claude') {
    const text = (response as { data?: { content?: Array<{ type?: string; text?: string }> } }).data?.content
      ?.find((part) => part?.type === 'text')?.text;
    if (typeof text === 'string' && text.trim()) return text;
  } else if (provider === 'openai' || provider === 'custom-openai') {
    const text = (response as { data?: { choices?: Array<{ message?: { content?: string } }> } }).data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && text.trim()) return text;
  } else {
    const text = (response as { data?: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } }).data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text === 'string' && text.trim()) return text;
  }
  throw new Error('LLM provider returned an empty or malformed guideline response.');
}

export class DefaultGuidelineProviderClient implements GuidelineProviderClient {
  async generate(args: {
    settings: Partial<AppSettings>;
    provider: LlmProvider;
    systemPrompt: string;
    userPrompt: string;
    isAborted?: () => boolean;
  }): Promise<string> {
    if (args.isAborted?.()) throw new Error('지침 생성이 취소되었습니다.');

    const { settings, provider, systemPrompt, userPrompt } = args;
    const timeout = getTimeout(settings);
    let response: unknown;

    if (provider === 'gemini') {
      response = await axios.post(getGeminiApiUrl(settings.llmModel || ''), {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      }, {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.llmApiKey || '' },
        timeout,
      });
    } else if (provider === 'vertex') {
      const credentials = parseVertexServiceAccountJson(settings.llmVertexServiceAccountJson || '');
      const accessToken = await createVertexAccessTokenProvider(credentials)();
      response = await axios.post(
        buildVertexApiUrl(credentials.project_id, settings.llmVertexLocation || DEFAULT_LLM_VERTEX_LOCATION, settings.llmModel || ''),
        {
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        },
        {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          timeout,
        },
      );
    } else if (provider === 'claude') {
      response = await axios.post(CLAUDE_MESSAGES_URL, {
        model: settings.llmModel || '',
        max_tokens: settings.llmMaxTokens || 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }, {
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': settings.llmClaudeApiKey || '',
        },
        timeout,
      });
    } else {
      const apiKey = provider === 'openai' ? settings.llmOpenAiApiKey : settings.llmCustomApiKey;
      const baseUrl = provider === 'openai' ? OPENAI_BASE_URL : settings.llmCustomBaseUrl || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
      response = await axios.post(buildChatCompletionsUrl(baseUrl), {
        model: settings.llmModel || '',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }, {
        headers,
        timeout,
      });
    }

    if (args.isAborted?.()) throw new Error('지침 생성이 취소되었습니다.');
    return stripMarkdownFences(getApiText(response, provider));
  }
}

export async function generateGuidelineDraft(
  profile: ProjectTranslationProfile,
  settings: Partial<AppSettings>,
  options: GuidelineGenerationOptions,
): Promise<GuidelineGenerationResult> {
  assertLlmReady(settings);
  if (options.isAborted?.()) throw new Error('지침 생성이 취소되었습니다.');

  const provider = normalizeLlmProvider(settings.llmProvider);
  const prompts = buildGuidelineGenerationPrompts(profile, {
    ...options,
    existingCustomPrompt: options.existingCustomPrompt ?? settings.llmCustomPrompt,
  });
  const providerClient = options.providerClient || new DefaultGuidelineProviderClient();
  const providerDraft = await providerClient.generate({
    settings,
    provider,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    isAborted: options.isAborted,
  });

  return {
    guideline: composeGuidelineDraft(providerDraft),
    providerDraft,
    boundedProfile: prompts.boundedProfile,
    promptChars: prompts.promptChars,
  };
}
