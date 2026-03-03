import path from 'path';
import fs from 'fs';
import { createGeminiTranslator, TranslationLog, TranslationLogEntry, contentHash } from '../libs/geminiTranslator';
import Tools from '../libs/projectTools';

const PROGRESS_FILE = '.llm_progress.json';
const CACHE_FILE = '.llm_cache.json';
const BACKUP_SUFFIX = '_backup';

interface ProgressState {
    completedFiles: string[];
    timestamp: string;
}

interface CacheStore {
    [fileHash: string]: { translatedContent: string; model: string; targetLang: string };
}

async function createBackup(edir: string): Promise<string> {
    const backupDir = edir + BACKUP_SUFFIX;
    if (fs.existsSync(backupDir)) {
        return backupDir;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const files = fs.readdirSync(edir).filter(f => f.endsWith('.txt'));
    for (let i = 0; i < files.length; i++) {
        fs.copyFileSync(path.join(edir, files[i]), path.join(backupDir, files[i]));
        // Yield to event loop every 50 files to prevent Chromium watchdog kill
        if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return backupDir;
}

function loadProgress(edir: string): ProgressState | null {
    const pfile = path.join(edir, PROGRESS_FILE);
    if (fs.existsSync(pfile)) {
        try {
            return JSON.parse(fs.readFileSync(pfile, 'utf-8'));
        } catch { return null; }
    }
    return null;
}

function saveProgress(edir: string, state: ProgressState) {
    fs.writeFileSync(path.join(edir, PROGRESS_FILE), JSON.stringify(state, null, 2), 'utf-8');
}

function clearProgress(edir: string) {
    const pfile = path.join(edir, PROGRESS_FILE);
    if (fs.existsSync(pfile)) fs.unlinkSync(pfile);
}

function loadCache(edir: string): CacheStore {
    const cfile = path.join(edir, CACHE_FILE);
    if (fs.existsSync(cfile)) {
        try { return JSON.parse(fs.readFileSync(cfile, 'utf-8')); } catch { return {}; }
    }
    return {};
}

function saveCache(edir: string, cache: CacheStore) {
    fs.writeFileSync(path.join(edir, CACHE_FILE), JSON.stringify(cache), 'utf-8');
}

function writeTranslationLog(edir: string, log: TranslationLog) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const logFile = path.join(edir, `translation_log_${ts}.json`);
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2), 'utf-8');
    return logFile;
}

interface TransArg {
    dir: string;
    game?: string;
    langu?: string;
    sortOrder?: string;
    resetProgress?: boolean;
    translationMode?: string;
}

export const trans = async (ev: unknown, arg: TransArg) => {
    Tools.send('llmTranslating', true);
    try {
        const dir = Buffer.from(arg.dir, "base64").toString('utf8');
        const edir = arg.game === 'wolf' ? path.join(dir, '_Extract', 'Texts') : path.join(dir, 'Extract');
        if (!fs.existsSync(edir)) {
            Tools.sendError('Extract 폴더가 존재하지 않습니다');
            Tools.send('llmTranslating', false);
            Tools.worked();
            return;
        }
        if (!globalThis.settings.llmApiKey) {
            Tools.sendError('Gemini API 키가 설정되지 않았습니다');
            Tools.send('llmTranslating', false);
            Tools.worked();
            return;
        }

        const targetLang = globalThis.settings.llmTargetLang || 'ko';
        const gemini = createGeminiTranslator(globalThis.settings, arg.langu || 'ja', targetLang);
        const fileList = fs.readdirSync(edir).filter(f => f.endsWith('.txt'));

        if (fileList.length === 0) {
            Tools.sendError('Extract 폴더에 번역할 .txt 파일이 없습니다');
            Tools.send('llmTranslating', false);
            Tools.worked();
            return;
        }

        // Sort files
        const sortOrder = arg.sortOrder || 'name-asc';
        if (sortOrder === 'name-desc') {
            fileList.sort((a, b) => b.localeCompare(a));
        } else if (sortOrder === 'size-asc') {
            fileList.sort((a, b) => fs.statSync(path.join(edir, a)).size - fs.statSync(path.join(edir, b)).size);
        } else if (sortOrder === 'size-desc') {
            fileList.sort((a, b) => fs.statSync(path.join(edir, b)).size - fs.statSync(path.join(edir, a)).size);
        } else {
            fileList.sort((a, b) => a.localeCompare(b));
        }

        // Auto-backup
        Tools.send('loadingTag', '백업 생성 중...');
        const backupDir = edir + BACKUP_SUFFIX;
        const translationMode = arg.translationMode || 'untranslated';

        // Reset if requested: restore originals from backup, clear progress/cache
        if (arg.resetProgress) {
            if (translationMode === 'all') {
                // Full reset: restore all originals, wipe backup/progress/cache
                if (fs.existsSync(backupDir)) {
                    const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.txt'));
                    for (const f of backupFiles) {
                        fs.copyFileSync(path.join(backupDir, f), path.join(edir, f));
                    }
                    fs.rmSync(backupDir, { recursive: true, force: true });
                }
                clearProgress(edir);
                const cfile = path.join(edir, CACHE_FILE);
                if (fs.existsSync(cfile)) fs.unlinkSync(cfile);
            } else {
                // Untranslated-only reset: keep translated files, only clear progress
                // and invalidate cache for untranslated files so they get fresh translations
                clearProgress(edir);
                if (fs.existsSync(backupDir)) {
                    const cache = loadCache(edir);
                    const backupFiles = fs.readdirSync(backupDir).filter(f => f.endsWith('.txt'));
                    let cacheModified = false;
                    for (const f of backupFiles) {
                        const filePath = path.join(edir, f);
                        const backupPath = path.join(backupDir, f);
                        if (fs.existsSync(filePath)) {
                            const fileContent = fs.readFileSync(filePath, 'utf-8');
                            const backupContent = fs.readFileSync(backupPath, 'utf-8');
                            if (fileContent === backupContent) {
                                // Untranslated file — invalidate its cache entry
                                const hash = contentHash(backupContent);
                                const cacheKey = `${hash}_${globalThis.settings.llmModel}_${targetLang}`;
                                if (cache[cacheKey]) {
                                    delete cache[cacheKey];
                                    cacheModified = true;
                                }
                            }
                        }
                    }
                    if (cacheModified) saveCache(edir, cache);
                }
            }
        }

        await createBackup(edir);

        // Resume state
        const prevProgress = loadProgress(edir);
        const completedFiles = new Set(prevProgress?.completedFiles || []);
        const isResuming = completedFiles.size > 0;

        // Cache
        const cache = loadCache(edir);
        const model = globalThis.settings.llmModel;

        // Log
        const translationLog: TranslationLog = {
            startTime: new Date().toISOString(),
            endTime: '',
            model,
            sourceLang: arg.langu || 'ja',
            targetLang,
            totalFiles: fileList.length,
            totalDurationMs: 0,
            entries: []
        };
        const startTime = Date.now();

        let totalErrors = 0;
        let totalBlocks = 0;
        let workedFiles = 0;
        const failedFiles: string[] = [];

        for (const fileName of fileList) {
            if (globalThis.llmAbort) break;
            const filePath = path.join(edir, fileName);
            const originalContent = fs.readFileSync(filePath, 'utf-8');

            // Resume: skip already completed files
            if (isResuming && completedFiles.has(fileName)) {
                workedFiles++;
                const pct = (workedFiles / fileList.length) * 100;
                Tools.send('loading', pct);
                Tools.send('loadingTag', `${fileName} (이전 번역 건너뜀)`);
                continue;
            }

            // Untranslated-only mode: skip files already translated (different from backup)
            if (translationMode === 'untranslated') {
                const backupPath = path.join(backupDir, fileName);
                if (fs.existsSync(backupPath)) {
                    const backupContent = fs.readFileSync(backupPath, 'utf-8');
                    if (originalContent !== backupContent) {
                        completedFiles.add(fileName);
                        saveProgress(edir, { completedFiles: [...completedFiles], timestamp: new Date().toISOString() });
                        workedFiles++;
                        const pct = (workedFiles / fileList.length) * 100;
                        Tools.send('loading', pct);
                        Tools.send('loadingTag', `${fileName} (번역됨, 건너뜀)`);
                        continue;
                    }
                }
            }

            // Cache: skip if content unchanged and same model/target
            const hash = contentHash(originalContent);
            const cacheKey = `${hash}_${model}_${targetLang}`;
            if (cache[cacheKey]) {
                fs.writeFileSync(filePath, cache[cacheKey].translatedContent, 'utf-8');
                completedFiles.add(fileName);
                saveProgress(edir, { completedFiles: [...completedFiles], timestamp: new Date().toISOString() });

                const logEntry: TranslationLogEntry = {
                    timestamp: new Date().toISOString(), fileName,
                    totalBlocks: 0, translatedBlocks: 0, skippedBlocks: 0,
                    errorBlocks: 0, retries: 0, cached: true, durationMs: 0, errors: []
                };
                translationLog.entries.push(logEntry);
                workedFiles++;
                const pct = (workedFiles / fileList.length) * 100;
                Tools.send('loading', pct);
                Tools.send('loadingTag', `${fileName} (캐시 사용)`);
                continue;
            }

            Tools.send('loadingTag', `[${workedFiles + 1}/${fileList.length}] ${fileName}`);

            const { translatedContent, validation, logEntry, aborted: fileAborted } = await gemini.translateFileContent(
                originalContent,
                (current, total, detail) => {
                    const fileProgress = (workedFiles / fileList.length) * 100;
                    const blockProgress = (current / total) * (100 / fileList.length);
                    Tools.send('loading', fileProgress + blockProgress);
                    Tools.send('loadingTag', `[${workedFiles + 1}/${fileList.length}] ${fileName} — ${detail} (${current}/${total} 블록)`);
                }
            );

            // If aborted mid-file, don't save partial translation
            if (fileAborted) break;

            // Only save and cache if translation actually produced different content
            const translationSucceeded = translatedContent !== originalContent;
            if (translationSucceeded) {
                fs.writeFileSync(filePath, translatedContent, 'utf-8');

                // Update cache
                cache[cacheKey] = { translatedContent, model, targetLang };
                saveCache(edir, cache);
            }

            // Only mark completed if translation succeeded
            if (translationSucceeded) {
                completedFiles.add(fileName);
                saveProgress(edir, { completedFiles: [...completedFiles], timestamp: new Date().toISOString() });
            } else {
                failedFiles.push(fileName);
            }

            const hasError = validation.some(b => !b.lineCountMatch || !b.separatorMatch);
            if (hasError) totalErrors += validation.filter(b => !b.lineCountMatch || !b.separatorMatch).length;
            totalBlocks += validation.length;

            const fullLogEntry: TranslationLogEntry = {
                timestamp: new Date().toISOString(),
                fileName,
                cached: false,
                ...logEntry
            } as TranslationLogEntry;
            translationLog.entries.push(fullLogEntry);
            workedFiles++;
        }

        // Finalize
        const aborted = !!globalThis.llmAbort;
        if (!aborted) clearProgress(edir);
        translationLog.endTime = new Date().toISOString();
        translationLog.totalDurationMs = Date.now() - startTime;
        const logFile = writeTranslationLog(edir, translationLog);

        Tools.send('loading', 0);
        Tools.send('loadingTag', '');

        const durationSec = Math.round(translationLog.totalDurationMs / 1000);
        const cacheNote = translationLog.entries.filter(e => e.cached).length;
        const cacheMsg = cacheNote > 0 ? `\n캐시 사용: ${cacheNote}개 파일` : '';
        const failMsg = failedFiles.length > 0
            ? `\n번역 실패: ${failedFiles.length}개 파일 (${failedFiles.slice(0, 5).join(', ')}${failedFiles.length > 5 ? ' ...' : ''})`
            : '';
        if (aborted) {
            Tools.sendAlert(
                `번역 중단 (${workedFiles}/${fileList.length} 파일 완료, ${durationSec}초 소요)${failMsg}`
            );
        } else {
            const resumeNote = isResuming ? `\n(이전 진행 상태에서 재개됨)` : '';
            Tools.sendAlert(
                `번역 완료! (${durationSec}초 소요)\n백업: ${backupDir}\n로그: ${path.basename(logFile)}${resumeNote}${cacheMsg}${failMsg}`
            );
        }
    } catch (err) {
        Tools.sendError(
            JSON.stringify(err, Object.getOwnPropertyNames(err))
        );
    }
    Tools.send('llmTranslating', false);
    Tools.worked();
}

export async function retranslateFile(
    edir: string,
    fileName: string,
    sourceLang: string,
    targetLang: string,
    onProgress?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
    const backupDir = edir + BACKUP_SUFFIX;
    const backupPath = path.join(backupDir, fileName);
    const filePath = path.join(edir, fileName);

    if (!fs.existsSync(backupPath)) {
        return { success: false, error: '백업 파일이 존재하지 않습니다' };
    }

    const originalContent = fs.readFileSync(backupPath, 'utf-8');
    const gemini = createGeminiTranslator(globalThis.settings, sourceLang, targetLang);
    const model = globalThis.settings.llmModel;

    // Invalidate cache for this file's original content and persist immediately
    const cache = loadCache(edir);
    const hash = contentHash(originalContent);
    const cacheKey = `${hash}_${model}_${targetLang}`;
    delete cache[cacheKey];
    saveCache(edir, cache);

    onProgress?.('번역 중...');

    const { translatedContent, logEntry } = await gemini.translateFileContent(
        originalContent,
        (current, total, detail) => {
            onProgress?.(`${detail} (${current}/${total} 블록)`);
        }
    );

    // Check if translation actually produced different content
    if (translatedContent === originalContent) {
        const errors = (logEntry.errors as string[]) || [];
        const reason = errors.length > 0 ? errors[0] : '번역 결과가 원본과 동일합니다';
        return { success: false, error: reason };
    }

    fs.writeFileSync(filePath, translatedContent, 'utf-8');

    cache[cacheKey] = { translatedContent, model, targetLang };
    saveCache(edir, cache);

    // Remove from progress so it can be re-translated in bulk runs too
    const progress = loadProgress(edir);
    if (progress) {
        progress.completedFiles = progress.completedFiles.filter(f => f !== fileName);
        saveProgress(edir, progress);
    }

    return { success: true };
}

export async function retranslateBlocks(
    edir: string,
    fileName: string,
    blockIndices: number[],
    sourceLang: string,
    targetLang: string,
    onProgress?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
    const backupDir = edir + BACKUP_SUFFIX;
    const backupPath = path.join(backupDir, fileName);
    const filePath = path.join(edir, fileName);

    if (!fs.existsSync(backupPath)) {
        return { success: false, error: '백업 파일이 존재하지 않습니다' };
    }

    const originalContent = fs.readFileSync(backupPath, 'utf-8');
    const transContent = fs.readFileSync(filePath, 'utf-8');
    const gemini = createGeminiTranslator(globalThis.settings, sourceLang, targetLang);

    // Split both files into blocks
    const origLines = originalContent.split('\n');
    const transLines = transContent.split('\n');
    const origBlocks = splitFileBlocks(origLines);
    const transBlocks = splitFileBlocks(transLines);

    // Collect original blocks to retranslate
    const toTranslate: { separator: string; lines: string[] }[] = [];
    for (const idx of blockIndices) {
        if (idx < origBlocks.length) {
            toTranslate.push(origBlocks[idx]);
        }
    }

    if (toTranslate.length === 0) {
        return { success: false, error: '재번역할 블록이 없습니다' };
    }

    // Reassemble selected blocks into text for translation
    const parts: string[] = [];
    for (const block of toTranslate) {
        if (block.separator) parts.push(block.separator);
        parts.push(...block.lines);
    }
    const textToTranslate = parts.join('\n');

    onProgress?.(`${blockIndices.length}개 블록 번역 중...`);

    try {
        let translated = await gemini.translateText(textToTranslate);
        if (textToTranslate.endsWith('\n') && !translated.endsWith('\n')) {
            translated += '\n';
        }

        // Split translated result back into blocks
        const translatedBlocks = splitFileBlocks(translated.split('\n'));

        // Replace only the selected blocks in the translated file
        for (let i = 0; i < blockIndices.length; i++) {
            const idx = blockIndices[i];
            if (idx < transBlocks.length && i < translatedBlocks.length) {
                transBlocks[idx] = translatedBlocks[i];
            }
        }

        // Reassemble and write
        const outParts: string[] = [];
        for (const block of transBlocks) {
            if (block.separator) outParts.push(block.separator);
            outParts.push(...block.lines);
        }
        fs.writeFileSync(filePath, outParts.join('\n'), 'utf-8');

        // Invalidate cache
        const cache = loadCache(edir);
        const hash = contentHash(originalContent);
        const model = globalThis.settings.llmModel;
        const cacheKey = `${hash}_${model}_${targetLang}`;
        delete cache[cacheKey];
        saveCache(edir, cache);

        return { success: true };
    } catch (err: unknown) {
        return { success: false, error: (err as Error).message || String(err) };
    }
}

// Local block splitter (same logic as geminiTranslator's splitIntoBlocks)
export function splitFileBlocks(lines: string[]): { separator: string; lines: string[] }[] {
    const SEP = /^---\s*\d+\s*---$/;
    const blocks: { separator: string; lines: string[] }[] = [];
    let curSep = '';
    let curLines: string[] = [];
    for (const line of lines) {
        if (SEP.test(line.trim())) {
            if (curSep || curLines.length > 0) {
                blocks.push({ separator: curSep, lines: [...curLines] });
            }
            curSep = line;
            curLines = [];
        } else {
            curLines.push(line);
        }
    }
    if (curSep || curLines.length > 0) {
        blocks.push({ separator: curSep, lines: curLines });
    }
    return blocks;
}