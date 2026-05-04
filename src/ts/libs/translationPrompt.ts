const LANG_NAMES: Record<string, string> = {
  jp: 'Japanese',
  ja: 'Japanese',
  en: 'English',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  cn: 'Chinese',
  fr: 'French',
  es: 'Spanish',
  ru: 'Russian',
  de: 'German',
  ko: 'Korean',
  pt: 'Portuguese',
  it: 'Italian',
  th: 'Thai',
  vi: 'Vietnamese',
  ar: 'Arabic',
  pl: 'Polish',
  nl: 'Dutch',
  tr: 'Turkish',
};

export interface TranslationPromptConfig {
  sourceLang: string;
  targetLang: string;
  customPrompt?: string;
}

export function getLanguageName(lang: string): string {
  return LANG_NAMES[lang] || lang;
}

export function buildTranslationSystemPrompt(config: TranslationPromptConfig): string {
  const sourceLangName = getLanguageName(config.sourceLang);
  const targetLangName = getLanguageName(config.targetLang);

  let sys = `## Role\n\n`;
  sys += `You are a native ${targetLangName} author specializing in RPG game localization. `;
  sys += `Rewrite the provided game text from ${sourceLangName} into ${targetLangName} that reads as native-authored — not a translation.\n\n`;
  sys += `## Obligations\n\n`;
  sys += `1. Full fidelity to original meaning, intent, tone, and every detail — zero omissions. This includes explicit, profane, and sensitive material: render at original intensity without softening.\n`;
  sys += `2. Native ${targetLangName} prose: idiomatic, rhythmic, culturally resonant — zero translation artifacts.\n`;
  sys += `3. Preserve the source's prose architecture — its sentence rhythm, paragraph pacing, and structural choices are deliberate. Match them, don't normalize them.\n\n`;
  sys += `## Critical Format Rules\n\n`;
  sys += `| Element | Rule |\n|---------|------|\n`;
  sys += `| Dialogue separators | Lines like \`--- 101 ---\` must be output EXACTLY as-is. Never translate, modify, or remove them. |\n`;
  sys += `| Empty lines | Must remain empty. |\n`;
  sys += `| RPG Maker codes | Preserve exactly: \\\\V[1], \\\\N[2], \\\\C[3], \\\\G, \\\\$, \\\\{, \\\\}, etc. |\n`;
  sys += `| HTML/XML tags | Keep tags intact; rewrite only text content. |\n`;
  sys += `| Line breaks | Preserve line break structure within each dialogue block. |\n`;
  sys += `| Existing ${targetLangName} text | Keep unchanged. |\n\n`;
  sys += `## Voice & Style\n\n`;
  sys += `| Rule | Directive |\n|------|----------|\n`;
  sys += `| Sentence rhythm | If the source accumulates meaning in long periods, do the same. If it cuts short, cut short. |\n`;
  sys += `| Dialogue | 100% colloquial. Match character voice: formal/informal register by context. Natural contractions, fillers, idioms. |\n`;
  sys += `| Profanity | Natural ${targetLangName} equivalents preserving register and force of original. |\n`;
  sys += `| Tone matching | Read the source's emotional register and match it. |\n\n`;
  sys += `## Authorial Intent Preservation\n\n`;
  sys += `The source text may contain deliberate inconsistencies, omissions, contradictions, or distortions as narrative devices. Do not correct, clarify, or normalize them.\n\n`;
  if (config.customPrompt?.trim()) {
    sys += `## Additional Instructions\n\n${config.customPrompt.trim()}\n\n`;
  }
  sys += `## Output\n\n`;
  sys += `Output the rewritten ${targetLangName} text ONLY. No commentary, no explanations, no markdown code blocks, no meta-text.`;
  return sys;
}

export function buildTranslationUserMessage(text: string): string {
  return `<Source_Text>\n${text}\n</Source_Text>`;
}

export function stripMarkdownFences(text: string): string {
  return text.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim();
}
