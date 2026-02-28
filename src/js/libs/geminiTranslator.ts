import { GoogleGenerativeAI } from '@google/generative-ai';
import { hanguls } from '../rpgmv/datas';
import * as crypto from 'crypto';

const SEPARATOR_REGEX = /^--- 101 ---$/;

export interface TranslationValidation {
    fileIndex: number;
    fileName: string;
    blocks: BlockValidation[];
    hasError: boolean;
}

export interface BlockValidation {
    index: number;
    separator: string;
    originalLines: string[];
    translatedLines: string[];
    lineCountMatch: boolean;
    separatorMatch: boolean;
}

export interface CompareData {
    files: TranslationValidation[];
    totalErrors: number;
    totalBlocks: number;
}

export interface TranslationLogEntry {
    timestamp: string;
    fileName: string;
    totalBlocks: number;
    translatedBlocks: number;
    skippedBlocks: number;
    errorBlocks: number;
    retries: number;
    cached: boolean;
    durationMs: number;
    errors: string[];
}

export interface TranslationLog {
    startTime: string;
    endTime: string;
    model: string;
    sourceLang: string;
    targetLang: string;
    totalFiles: number;
    totalDurationMs: number;
    entries: TranslationLogEntry[];
}

interface GeminiConfig {
    apiKey: string;
    model: string;
    customPrompt: string;
    translatorNotes: string;
    chunkSize: number;
    translationUnit: string;
    sourceLang: string;
    targetLang: string;
    doNotTransHangul: boolean;
}

function parseTranslatorNotes(notes: string): { from: string; to: string }[] {
    if (!notes.trim()) return [];
    return notes.split('\n')
        .map(line => line.trim())
        .filter(line => line.includes('='))
        .map(line => {
            const idx = line.indexOf('=');
            return { from: line.substring(0, idx), to: line.substring(idx + 1) };
        })
        .filter(entry => entry.from && entry.to);
}

function splitIntoBlocks(content: string): { separator: string; lines: string[] }[] {
    const allLines = content.split('\n');
    const blocks: { separator: string; lines: string[] }[] = [];
    let currentSep = '';
    let currentLines: string[] = [];

    for (const line of allLines) {
        if (SEPARATOR_REGEX.test(line.trim())) {
            if (currentSep !== '' || currentLines.length > 0) {
                blocks.push({ separator: currentSep, lines: [...currentLines] });
            }
            currentSep = line;
            currentLines = [];
        } else {
            currentLines.push(line);
        }
    }
    if (currentSep !== '' || currentLines.length > 0) {
        blocks.push({ separator: currentSep, lines: currentLines });
    }
    return blocks;
}

function reassembleBlocks(blocks: { separator: string; lines: string[] }[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
        if (block.separator) {
            parts.push(block.separator);
        }
        parts.push(...block.lines);
    }
    return parts.join('\n');
}

function buildPrompt(config: GeminiConfig, text: string): string {
    const langNames: { [key: string]: string } = {
        'jp': 'Japanese', 'ja': 'Japanese', 'en': 'English',
        'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', 'cn': 'Chinese',
        'fr': 'French', 'es': 'Spanish', 'ru': 'Russian', 'de': 'German', 'ko': 'Korean',
        'pt': 'Portuguese', 'it': 'Italian', 'th': 'Thai', 'vi': 'Vietnamese',
        'ar': 'Arabic', 'pl': 'Polish', 'nl': 'Dutch', 'tr': 'Turkish'
    };
    const sourceLangName = langNames[config.sourceLang] || config.sourceLang;
    const targetLangName = langNames[config.targetLang] || config.targetLang;

    let prompt = '';
    prompt += `You are a professional game dialogue translator. Translate the following RPG game text from ${sourceLangName} to ${targetLangName}.\n\n`;
    prompt += `CRITICAL RULES:\n`;
    prompt += `1. Lines that are exactly "--- 101 ---" are dialogue separators. Do NOT translate, modify, or remove them. Output them EXACTLY as "--- 101 ---".\n`;
    prompt += `2. Preserve the EXACT number of line breaks within each dialogue block. If the original has 3 lines between separators, the translation must also have exactly 3 lines.\n`;
    prompt += `3. Preserve any special codes like \\V[1], \\N[2], \\C[3], \\G, \\$, etc. exactly as they appear.\n`;
    prompt += `4. Output ONLY the translated text. No explanations, no markdown formatting, no code blocks.\n`;
    prompt += `5. Empty lines must remain empty.\n`;

    const notes = parseTranslatorNotes(config.translatorNotes);
    if (notes.length > 0) {
        prompt += `\nTranslation Glossary (MUST use these exact translations):\n`;
        for (const note of notes) {
            prompt += `- "${note.from}" → "${note.to}"\n`;
        }
    }

    if (config.customPrompt.trim()) {
        prompt += `\nAdditional instructions:\n${config.customPrompt.trim()}\n`;
    }

    prompt += `\nTranslate the following text:\n\n${text}`;
    return prompt;
}

function validateChunk(
    originalBlocks: { separator: string; lines: string[] }[],
    translatedText: string
): { validatedBlocks: { separator: string; lines: string[] }[]; blockValidations: BlockValidation[] } {
    const translatedBlocks = splitIntoBlocks(translatedText);
    const blockValidations: BlockValidation[] = [];
    const validatedBlocks: { separator: string; lines: string[] }[] = [];

    for (let i = 0; i < originalBlocks.length; i++) {
        const origBlock = originalBlocks[i];
        const transBlock = translatedBlocks[i];

        if (!transBlock) {
            blockValidations.push({
                index: i, separator: origBlock.separator,
                originalLines: origBlock.lines, translatedLines: origBlock.lines,
                lineCountMatch: false, separatorMatch: false
            });
            validatedBlocks.push({ ...origBlock });
            continue;
        }

        const sepMatch = origBlock.separator === transBlock.separator;
        const lineMatch = origBlock.lines.length === transBlock.lines.length;

        blockValidations.push({
            index: i, separator: origBlock.separator,
            originalLines: origBlock.lines, translatedLines: transBlock.lines,
            lineCountMatch: lineMatch,
            separatorMatch: origBlock.separator === '' || sepMatch
        });

        validatedBlocks.push({
            separator: origBlock.separator,
            lines: lineMatch ? transBlock.lines : origBlock.lines
        });
    }

    if (translatedBlocks.length > originalBlocks.length) {
        for (let i = originalBlocks.length; i < translatedBlocks.length; i++) {
            blockValidations.push({
                index: i, separator: translatedBlocks[i].separator,
                originalLines: [], translatedLines: translatedBlocks[i].lines,
                lineCountMatch: false, separatorMatch: false
            });
        }
    }

    return { validatedBlocks, blockValidations };
}

// Check if an error is a retryable API error (rate limit, server error)
function isRetryableApiError(error: any): boolean {
    if (!error) return false;
    const msg = String(error.message || error).toLowerCase();
    return msg.includes('429') || msg.includes('503') || msg.includes('resource_exhausted')
        || msg.includes('rate limit') || msg.includes('quota') || msg.includes('overloaded')
        || msg.includes('internal') || msg.includes('unavailable') || msg.includes('deadline');
}

// Compute content hash for caching
export function contentHash(content: string): string {
    return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

export class GeminiTranslator {
    private genAI: GoogleGenerativeAI;
    private config: GeminiConfig;
    private model: any;

    constructor(config: GeminiConfig) {
        this.config = config;
        this.genAI = new GoogleGenerativeAI(config.apiKey);
        this.model = this.genAI.getGenerativeModel({ model: config.model });
    }

    async translateText(text: string): Promise<string> {
        const prompt = buildPrompt(this.config, text);
        const result = await this.model.generateContent(prompt);
        const response = result.response;
        let translated = response.text();
        translated = translated.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
        return translated.trim();
    }

    async translateFileContent(
        content: string,
        onProgress?: (current: number, total: number, detail: string) => void
    ): Promise<{ translatedContent: string; validation: BlockValidation[]; logEntry: Partial<TranslationLogEntry> }> {
        const startTime = Date.now();
        const allBlocks = splitIntoBlocks(content);
        const isFileMode = this.config.translationUnit === 'file';
        const chunkSize = isFileMode ? allBlocks.length : this.config.chunkSize;
        const allValidations: BlockValidation[] = [];
        const allTranslatedBlocks: { separator: string; lines: string[] }[] = [];

        const logData: Partial<TranslationLogEntry> = {
            totalBlocks: allBlocks.length,
            translatedBlocks: 0,
            skippedBlocks: 0,
            errorBlocks: 0,
            retries: 0,
            errors: []
        };

        const chunks: { separator: string; lines: string[] }[][] = [];
        for (let i = 0; i < allBlocks.length; i += chunkSize) {
            chunks.push(allBlocks.slice(i, i + chunkSize));
        }

        let processedBlocks = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            const chunkText = reassembleBlocks(chunk);

            if (onProgress) {
                onProgress(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length}`);
            }

            // Skip hangul-only chunks
            if (this.config.doNotTransHangul && hanguls.test(chunkText)) {
                for (const block of chunk) {
                    allTranslatedBlocks.push({ ...block });
                    allValidations.push({
                        index: processedBlocks, separator: block.separator,
                        originalLines: block.lines, translatedLines: block.lines,
                        lineCountMatch: true, separatorMatch: true
                    });
                    processedBlocks++;
                    logData.skippedBlocks++;
                }
                if (onProgress) onProgress(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} (건너뜀)`);
                continue;
            }

            let validation: { validatedBlocks: { separator: string; lines: string[] }[]; blockValidations: BlockValidation[] } = {
                validatedBlocks: chunk.map(b => ({ ...b })),
                blockValidations: chunk.map((b, idx) => ({
                    index: processedBlocks + idx, separator: b.separator,
                    originalLines: b.lines, translatedLines: b.lines,
                    lineCountMatch: true, separatorMatch: true
                }))
            };

            let retries = 0;
            const maxRetries = 2;
            const maxApiRetries = 5;
            let apiRetries = 0;
            let success = false;

            while (!success && retries <= maxRetries) {
                try {
                    const translated = await this.translateText(chunkText);
                    validation = validateChunk(chunk, translated);

                    const hasError = validation.blockValidations.some(b => !b.lineCountMatch || !b.separatorMatch);

                    if (!hasError) {
                        success = true;
                        logData.translatedBlocks += chunk.length;
                    } else if (retries < maxRetries) {
                        retries++;
                        logData.retries++;
                        console.log(`Chunk ${ci} validation failed, retrying (${retries}/${maxRetries})...`);
                    } else {
                        logData.errorBlocks += validation.blockValidations.filter(b => !b.lineCountMatch || !b.separatorMatch).length;
                        logData.errors.push(`Chunk ${ci}: validation failed after ${maxRetries} retries`);
                        success = true;
                    }
                } catch (error) {
                    if (isRetryableApiError(error) && apiRetries < maxApiRetries) {
                        apiRetries++;
                        logData.retries++;
                        const backoffMs = Math.min(2000 * Math.pow(2, apiRetries - 1), 60000);
                        console.log(`API error on chunk ${ci}, backoff ${backoffMs}ms (${apiRetries}/${maxApiRetries})...`);
                        logData.errors.push(`Chunk ${ci}: API retry ${apiRetries} (${String(error).substring(0, 100)})`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        continue;
                    }

                    console.error(`Chunk ${ci} translation error:`, error);
                    logData.errors.push(`Chunk ${ci}: ${String(error).substring(0, 200)}`);

                    if (retries >= maxRetries) {
                        validation = {
                            validatedBlocks: chunk.map(b => ({ ...b })),
                            blockValidations: chunk.map((b, idx) => ({
                                index: processedBlocks + idx, separator: b.separator,
                                originalLines: b.lines, translatedLines: b.lines,
                                lineCountMatch: true, separatorMatch: true
                            }))
                        };
                        logData.skippedBlocks += chunk.length;
                        success = true;
                    } else {
                        retries++;
                        logData.retries++;
                    }
                }
            }

            for (const vb of validation.validatedBlocks) {
                allTranslatedBlocks.push(vb);
            }
            for (const bv of validation.blockValidations) {
                bv.index = processedBlocks;
                allValidations.push(bv);
                processedBlocks++;
            }

            if (onProgress) onProgress(processedBlocks, allBlocks.length, `청크 ${ci + 1}/${chunks.length} 완료`);

            // Rate limit delay between chunks
            if (ci < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        logData.durationMs = Date.now() - startTime;

        return {
            translatedContent: reassembleBlocks(allTranslatedBlocks),
            validation: allValidations,
            logEntry: logData
        };
    }
}

export function createGeminiTranslator(settings: any, sourceLang: string, targetLang = 'ko'): GeminiTranslator {
    return new GeminiTranslator({
        apiKey: settings.llmApiKey,
        model: settings.llmModel,
        customPrompt: settings.llmCustomPrompt,
        translatorNotes: settings.llmTranslatorNotes,
        chunkSize: settings.llmChunkSize || 30,
        translationUnit: settings.llmTranslationUnit || 'chunk',
        sourceLang,
        targetLang,
        doNotTransHangul: settings.DoNotTransHangul
    });
}