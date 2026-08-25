import axios from 'axios';
import type { AppSettings } from '../../types/settings';
import { DEFAULT_API_TIMEOUT_SEC } from './constants';
import { ProviderTranslationBase } from './providerTranslationBase';

interface GeminiConfig {
    apiKey: string;
    model: string;
    customPrompt: string;
    chunkSize: number;
    translationUnit: string;
    sourceLang: string;
    targetLang: string;
    doNotTransHangul: boolean;
    maxRetries: number;
    maxApiRetries: number;
    timeout: number;
    isAborted?: () => boolean;
}

const LANG_NAMES: { [key: string]: string } = {
    'jp': 'Japanese', 'ja': 'Japanese', 'en': 'English',
    'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'cn': 'Chinese',
    'fr': 'French', 'es': 'Spanish', 'ru': 'Russian', 'de': 'German', 'ko': 'Korean',
    'pt': 'Portuguese', 'it': 'Italian', 'th': 'Thai', 'vi': 'Vietnamese',
    'ar': 'Arabic', 'pl': 'Polish', 'nl': 'Dutch', 'tr': 'Turkish'
};

function buildSystemInstruction(config: GeminiConfig): string {
    const sourceLangName = LANG_NAMES[config.sourceLang] || config.sourceLang;
    const targetLangName = LANG_NAMES[config.targetLang] || config.targetLang;

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
    sys += `| Pro-drop | Omit subjects when context is sufficient. Never open every sentence with he/she equivalents. |\n`;
    sys += `| Dialogue | 100% colloquial. Match character voice: formal/informal register by context. Natural contractions, fillers, idioms. |\n`;
    sys += `| Profanity | Natural ${targetLangName} equivalents preserving register and force of original. |\n`;
    sys += `| Tone matching | Read the source's emotional register and match it. Tense → fragmented, rapid. Romantic → lyrical, sensory. Comedy → snappy, fast. Peaceful → unhurried, spacious. |\n`;
    sys += `| Sensory detail | Use onomatopoeia and mimetic words actively when appropriate. |\n`;
    sys += `| Character voice | Reproduce speech patterns — archaic, rough, refined, childish — using equivalent ${targetLangName} registers. |\n\n`;

    sys += `## Anti-Translationese\n\n`;
    sys += `| Instead of (stiff literal) | Use (natural ${targetLangName}) |\n|---------------------------|-------------------------------|\n`;
    sys += `| Verbose cognitive constructions | Direct perception statements |\n`;
    sys += `| Formal connectives in dialogue | Colloquial conjunctions or omission |\n`;
    sys += `| Overused temporal markers | Concrete sensory descriptions |\n`;
    sys += `| Verbose sentence endings | Concise endings |\n\n`;

    sys += `## Authorial Intent Preservation\n\n`;
    sys += `The source text may contain deliberate inconsistencies, omissions, contradictions, or distortions as narrative devices. These are not errors. Do not correct, clarify, or normalize them. Rewrite them as they are — the reader is meant to encounter them intact.\n\n`;

    if (config.customPrompt.trim()) {
        sys += `## Additional Instructions\n\n${config.customPrompt.trim()}\n\n`;
    }

    sys += `## Output\n\n`;
    sys += `Output the rewritten ${targetLangName} text ONLY. No commentary, no explanations, no markdown code blocks, no meta-text.\n\n`;

    sys += `## Validation (Apply silently)\n\n`;
    sys += `Before output, verify:\n`;
    sys += `- Is every sentence of source accounted for?\n`;
    sys += `- Does the prose architecture match the source?\n`;
    sys += `- Is explicit/profane/sensitive content at original intensity?\n`;
    sys += `- Does the text read as native ${targetLangName} with zero translation artifacts?\n`;
    sys += `- Are all format elements (separators, RPG codes, tags) intact?`;

    return sys;
}

function buildUserMessage(text: string): string {
    return `<Source_Text>\n${text}\n</Source_Text>`;
}

function normalizeGeminiError(error: unknown, apiKey: string): Error {
    const responseMessage = (error as {
        response?: { data?: { error?: { message?: unknown } } };
    })?.response?.data?.error?.message;
    const rawMessage = typeof responseMessage === 'string' && responseMessage.trim()
        ? responseMessage.trim()
        : error instanceof Error
            ? error.message
            : String(error);
    const redactedMessage = apiKey.trim()
        ? rawMessage.split(apiKey).join('[REDACTED]')
        : rawMessage;
    const normalized = new Error(`Gemini API error: ${redactedMessage}`) as Error & { code?: string };
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string') normalized.code = code;
    return normalized;
}

export class GeminiTranslator extends ProviderTranslationBase {
    private config: GeminiConfig;
    private apiUrl: string;

    constructor(config: GeminiConfig) {
        super({
            chunkSize: config.chunkSize,
            translationUnit: config.translationUnit,
            doNotTransHangul: config.doNotTransHangul,
            maxRetries: config.maxRetries,
            maxApiRetries: config.maxApiRetries,
            isAborted: config.isAborted,
        });
        this.config = config;
        const modelPath = config.model.includes('/') ? config.model : `models/${config.model}`;
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
    }

    async translateText(text: string): Promise<string> {
        const systemInstruction = buildSystemInstruction(this.config);
        const userMessage = buildUserMessage(text);
        const targetLangName = LANG_NAMES[this.config.targetLang] || this.config.targetLang;
        const prefill = `(지침을 숙지했습니다. ${targetLangName} 리라이팅 결과를 출력합니다.)\n`;
        let response;
        try {
            response = await axios.post(this.apiUrl, {
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [
                    { role: 'user', parts: [{ text: userMessage }] },
                    { role: 'model', parts: [{ text: prefill }] }
                ],
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
            }, {
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
                timeout: this.config.timeout
            });
        } catch (error) {
            throw normalizeGeminiError(error, this.config.apiKey);
        }
        const candidates = response.data?.candidates;
        if (!candidates || candidates.length === 0) {
            const blockReason = response.data?.promptFeedback?.blockReason;
            const msg = blockReason
                ? `Gemini API blocked (${blockReason})`
                : 'Gemini API returned no candidates';
            throw new Error(msg);
        }
        let translated = candidates[0]?.content?.parts?.[0]?.text || '';
        translated = translated.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
        return translated.trim();
    }

}

export function createGeminiTranslator(settings: Partial<AppSettings>, sourceLang: string, targetLang = 'ko', isAborted?: () => boolean): GeminiTranslator {
    return new GeminiTranslator({
        apiKey: settings.llmApiKey || '',
        model: settings.llmModel || '',
        customPrompt: settings.llmCustomPrompt || '',
        chunkSize: settings.llmChunkSize || 30,
        translationUnit: settings.llmTranslationUnit || 'file',
        sourceLang,
        targetLang,
        doNotTransHangul: !!settings.DoNotTransHangul,
        maxRetries: settings.llmMaxRetries ?? 2,
        maxApiRetries: settings.llmMaxApiRetries ?? 5,
        timeout: (settings.llmTimeout || DEFAULT_API_TIMEOUT_SEC) * 1000,
        isAborted
    });
}

export {
    splitIntoBlocks,
    reassembleBlocks,
    validateChunk,
    isPermanentApiError,
    isRetryableApiError,
    contentHash,
    type TranslationLog,
    type TranslationLogEntry,
} from './translationCore';
