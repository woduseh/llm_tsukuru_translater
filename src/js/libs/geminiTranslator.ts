import axios from 'axios';
import { hanguls } from '../rpgmv/datas';
import * as crypto from 'crypto';

const SEPARATOR_REGEX = /^--- 101 ---$/;

export interface BlockValidation {
    index: number;
    separator: string;
    originalLines: string[];
    translatedLines: string[];
    lineCountMatch: boolean;
    separatorMatch: boolean;
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
    chunkSize: number;
    translationUnit: string;
    sourceLang: string;
    targetLang: string;
    doNotTransHangul: boolean;
    maxRetries: number;
    maxApiRetries: number;
    timeout: number;
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
            lines: transBlock.lines
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

// Check if an error is permanent (safety block, timeout — retrying won't help)
function isPermanentApiError(error: any): boolean {
    if (!error) return false;
    const msg = String(error.message || error).toLowerCase();
    const code = String(error.code || '').toLowerCase();
    return msg.includes('blocked') || msg.includes('timeout') || code === 'econnaborted';
}

// Check if an error is a retryable API error (rate limit, server error, transient)
function isRetryableApiError(error: any): boolean {
    if (!error) return false;
    const msg = String(error.message || error).toLowerCase();
    return msg.includes('429') || msg.includes('503') || msg.includes('resource_exhausted')
        || msg.includes('rate limit') || msg.includes('quota') || msg.includes('overloaded')
        || msg.includes('internal') || msg.includes('unavailable') || msg.includes('deadline')
        || msg.includes('no candidates');
}

// Compute content hash for caching
export function contentHash(content: string): string {
    return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

export class GeminiTranslator {
    private config: GeminiConfig;
    private apiUrl: string;

    constructor(config: GeminiConfig) {
        this.config = config;
        const modelPath = config.model.includes('/') ? config.model : `models/${config.model}`;
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${config.apiKey}`;
    }

    async translateText(text: string): Promise<string> {
        const systemInstruction = buildSystemInstruction(this.config);
        const userMessage = buildUserMessage(text);
        const targetLangName = LANG_NAMES[this.config.targetLang] || this.config.targetLang;
        const prefill = `(지침을 숙지했습니다. ${targetLangName} 리라이팅 결과를 출력합니다.)\n`;
        const response = await axios.post(this.apiUrl, {
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
            headers: { 'Content-Type': 'application/json' },
            timeout: this.config.timeout
        });
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

    async translateFileContent(
        content: string,
        onProgress?: (current: number, total: number, detail: string) => void
    ): Promise<{ translatedContent: string; validation: BlockValidation[]; logEntry: Partial<TranslationLogEntry>; aborted?: boolean }> {
        const startTime = Date.now();
        const allBlocks = splitIntoBlocks(content);
        const isFileMode = this.config.translationUnit === 'file';
        const chunkSize = isFileMode ? allBlocks.length : this.config.chunkSize;
        const allValidations: BlockValidation[] = [];
        const allTranslatedBlocks: { separator: string; lines: string[] }[] = [];

        const logData = {
            totalBlocks: allBlocks.length,
            translatedBlocks: 0,
            skippedBlocks: 0,
            errorBlocks: 0,
            retries: 0,
            errors: [] as string[],
            durationMs: 0
        };

        const chunks: { separator: string; lines: string[] }[][] = [];
        for (let i = 0; i < allBlocks.length; i += chunkSize) {
            chunks.push(allBlocks.slice(i, i + chunkSize));
        }

        let processedBlocks = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
            // Check abort flag between chunks
            if (globalThis.llmAbort) break;

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
            const maxRetries = this.config.maxRetries;
            const maxApiRetries = this.config.maxApiRetries;
            let apiRetries = 0;
            let success = false;

            while (!success && retries <= maxRetries) {
                if (globalThis.llmAbort) break;
                try {
                    let translated = await this.translateText(chunkText);
                    // Normalize trailing newline to match original
                    if (chunkText.endsWith('\n') && !translated.endsWith('\n')) {
                        translated += '\n';
                    }
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
                    // Permanent errors (safety blocks): skip chunk immediately, retrying won't help
                    if (isPermanentApiError(error)) {
                        console.error(`Chunk ${ci} permanently blocked:`, error);
                        logData.errors.push(`Chunk ${ci}: ${String(error).substring(0, 200)}`);
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
                    } else if (isRetryableApiError(error) && apiRetries < maxApiRetries) {
                        apiRetries++;
                        logData.retries++;
                        const backoffMs = Math.min(2000 * Math.pow(2, apiRetries - 1), 60000);
                        console.log(`API error on chunk ${ci}, backoff ${backoffMs}ms (${apiRetries}/${maxApiRetries})...`);
                        logData.errors.push(`Chunk ${ci}: API retry ${apiRetries} (${String(error).substring(0, 100)})`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        continue;
                    } else {
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
                            const backoffMs = Math.min(2000 * Math.pow(2, retries), 30000);
                            await new Promise(r => setTimeout(r, backoffMs));
                        }
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
            logEntry: logData,
            aborted: !!globalThis.llmAbort
        };
    }
}

export function createGeminiTranslator(settings: any, sourceLang: string, targetLang = 'ko'): GeminiTranslator {
    return new GeminiTranslator({
        apiKey: settings.llmApiKey,
        model: settings.llmModel,
        customPrompt: settings.llmCustomPrompt,
        chunkSize: settings.llmChunkSize || 30,
        translationUnit: settings.llmTranslationUnit || 'file',
        sourceLang,
        targetLang,
        doNotTransHangul: settings.DoNotTransHangul,
        maxRetries: settings.llmMaxRetries ?? 2,
        maxApiRetries: settings.llmMaxApiRetries ?? 5,
        timeout: (settings.llmTimeout || 600) * 1000
    });
}