import axios from 'axios';
import type { AppSettings } from '../../types/settings';
import { buildTranslationSystemPrompt, buildTranslationUserMessage, getLanguageName, stripMarkdownFences } from './translationPrompt';
import { ProviderTranslationBase, createProviderTranslatorConfig, type ProviderTranslatorConfig } from './providerTranslationBase';

interface GeminiConfig extends ProviderTranslatorConfig {
    apiKey: string;
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
        super(config);
        this.config = config;
        const modelPath = config.model.includes('/') ? config.model : `models/${config.model}`;
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
    }

    async translateText(text: string): Promise<string> {
        const systemInstruction = buildTranslationSystemPrompt(this.config, 'google');
        const userMessage = buildTranslationUserMessage(text);
        const targetLangName = getLanguageName(this.config.targetLang);
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
        const translated = candidates[0]?.content?.parts?.[0]?.text || '';
        return stripMarkdownFences(translated);
    }

}

export function createGeminiTranslator(settings: Partial<AppSettings>, sourceLang: string, targetLang = 'ko', isAborted?: () => boolean): GeminiTranslator {
    return new GeminiTranslator({
        ...createProviderTranslatorConfig(settings, sourceLang, targetLang, isAborted),
        apiKey: settings.llmApiKey || '',
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
