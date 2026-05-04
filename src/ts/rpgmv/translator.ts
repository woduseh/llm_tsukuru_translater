import path from 'path';
import fs from 'fs';
import Tools from '../libs/projectTools';
import { AppContext } from '../../appContext';
import { TranslationLog, TranslationLogEntry, contentHash } from '../libs/translationCore';
import type { BlockValidation } from '../libs/translationCore';
import { atomicWriteJsonFile, atomicWriteTextFile } from '../libs/atomicFile';
import { runWithDirectoryLock } from '../libs/concurrency';
import { getProviderRegistryEntry } from '../libs/providerRegistry';
import {
    buildTranslationCacheKey,
    createTranslator,
    getLlmReadinessError,
    normalizeLlmProvider,
    type Translator,
} from '../libs/translatorFactory';

const PROGRESS_FILE = '.llm_progress.json';
const CACHE_FILE = '.llm_cache.json';
const BACKUP_SUFFIX = '_backup';

interface ProgressState {
    completedFiles: string[];
    timestamp: string;
}

interface CacheStore {
    [fileHash: string]: { translatedContent: string; model: string; targetLang: string; provider?: string };
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
    atomicWriteJsonFile(path.join(edir, PROGRESS_FILE), state, 2);
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
    atomicWriteJsonFile(path.join(edir, CACHE_FILE), cache, 0);
}

function writeTranslationLog(edir: string, log: TranslationLog) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const logFile = path.join(edir, `translation_log_${ts}.json`);
    atomicWriteJsonFile(logFile, log, 2);
    return logFile;
}

interface TransArg {
    dir: string;
    game?: string;
    langu?: string;
    sortOrder?: string;
    resetProgress?: boolean;
    parallelWorkers?: number;
    translationMode?: string;
}

interface PendingTranslationFile {
    fileName: string;
    fileOrdinal: number;
    originalContent: string;
    cacheKey: string;
}

interface TranslationFileResult extends PendingTranslationFile {
    translatedContent: string;
    validation: BlockValidation[];
    logEntry: Partial<TranslationLogEntry>;
    aborted: boolean;
    durationMs: number;
}

export interface TranslationCoordinatorOptions {
    edir: string;
    backupDir: string;
    fileList: string[];
    completedFiles: Set<string>;
    cache: CacheStore;
    provider: string;
    model: string;
    sourceLang: string;
    targetLang: string;
    settings: AppContext['settings'];
    translationMode: string;
    isResuming: boolean;
    workerCount: number;
    isAborted: () => boolean;
    createTranslatorForFile?: (fileName: string) => Translator;
    onProgress?: (percent: number) => void;
    onStatus?: (message: string) => void;
}

export interface TranslationCoordinatorResult {
    workedFiles: number;
    failedFiles: string[];
    totalErrors: number;
    totalBlocks: number;
    entries: TranslationLogEntry[];
}

export interface FileValidationResult {
    ok: boolean;
    errors: string[];
}

const SEPARATOR_LINE_REGEX = /^---\s*\d+\s*---$/;
const CONTROL_CODE_REGEX = /\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[{}$|.!><^])|%[0-9]/g;

export function validateTranslatedFileContent(
    originalContent: string,
    translatedContent: string,
    blockValidation: BlockValidation[] = [],
): FileValidationResult {
    const errors: string[] = [];
    const originalLines = originalContent.split('\n');
    const translatedLines = translatedContent.split('\n');

    if (originalLines.length !== translatedLines.length) {
        errors.push(`line count changed (${originalLines.length} -> ${translatedLines.length})`);
    }

    const maxLines = Math.max(originalLines.length, translatedLines.length);
    for (let i = 0; i < maxLines; i++) {
        const originalLine = originalLines[i] ?? '';
        const translatedLine = translatedLines[i] ?? '';
        const lineNo = i + 1;
        const originalIsSeparator = SEPARATOR_LINE_REGEX.test(originalLine.trim());
        const translatedIsSeparator = SEPARATOR_LINE_REGEX.test(translatedLine.trim());

        if (originalIsSeparator || translatedIsSeparator) {
            if (originalLine !== translatedLine) {
                errors.push(`separator changed at line ${lineNo}`);
            }
        }

        if (originalLine === '' && translatedLine !== '') {
            errors.push(`empty line filled at line ${lineNo}`);
        } else if (originalLine !== '' && translatedLine === '') {
            errors.push(`non-empty line emptied at line ${lineNo}`);
        }

        const originalCodes = extractControlCodes(originalLine);
        const translatedCodes = extractControlCodes(translatedLine);
        if (!sameStringArray(originalCodes, translatedCodes)) {
            errors.push(`control codes changed at line ${lineNo}`);
        }
    }

    const failedBlocks = blockValidation.filter((b) => !b.lineCountMatch || !b.separatorMatch);
    if (failedBlocks.length > 0) {
        errors.push(`block validation failed (${failedBlocks.length} blocks)`);
    }

    return { ok: errors.length === 0, errors };
}

export function resolveLlmParallelWorkers(provider: string, requested: unknown): number {
    const requestedWorkers = Number.isInteger(requested) ? requested as number : 1;
    const safeRequested = Math.max(1, Math.min(16, requestedWorkers));
    const providerCap = Math.max(1, getProviderRegistryEntry(provider).concurrencyCap || 1);
    return Math.min(safeRequested, providerCap);
}

export async function translateFilesWithCoordinator(options: TranslationCoordinatorOptions): Promise<TranslationCoordinatorResult> {
    const entries: TranslationLogEntry[] = [];
    const failedFiles: string[] = [];
    const pending: PendingTranslationFile[] = [];
    let workedFiles = 0;
    let totalErrors = 0;
    let totalBlocks = 0;

    const saveProgressState = () => saveProgress(options.edir, {
        completedFiles: [...options.completedFiles],
        timestamp: new Date().toISOString(),
    });

    const markWorked = (fileName: string, detail: string) => {
        workedFiles++;
        options.onProgress?.((workedFiles / options.fileList.length) * 100);
        options.onStatus?.(`${fileName} ${detail}`);
    };

    for (let fileIndex = 0; fileIndex < options.fileList.length; fileIndex++) {
        const fileName = options.fileList[fileIndex];
        const fileOrdinal = fileIndex + 1;
        if (options.isAborted()) {
            break;
        }

        const filePath = path.join(options.edir, fileName);
        const originalContent = fs.readFileSync(filePath, 'utf-8');

        if (options.isResuming && options.completedFiles.has(fileName)) {
            markWorked(fileName, '(이전 번역 건너뜀)');
            continue;
        }

        if (options.translationMode === 'untranslated') {
            const backupPath = path.join(options.backupDir, fileName);
            if (fs.existsSync(backupPath)) {
                const backupContent = fs.readFileSync(backupPath, 'utf-8');
                if (originalContent !== backupContent) {
                    options.completedFiles.add(fileName);
                    saveProgressState();
                    markWorked(fileName, '(번역됨, 건너뜀)');
                    continue;
                }
            }
        }

        const hash = contentHash(originalContent);
        const cacheKey = buildTranslationCacheKey(options.provider, hash, options.model, options.targetLang);
        const cached = options.cache[cacheKey];
        if (cached) {
            const validation = validateTranslatedFileContent(originalContent, cached.translatedContent);
            if (validation.ok) {
                atomicWriteTextFile(filePath, cached.translatedContent, { encoding: 'utf-8' });
                options.completedFiles.add(fileName);
                saveProgressState();
                entries.push({
                    timestamp: new Date().toISOString(),
                    fileName,
                    totalBlocks: 0,
                    translatedBlocks: 0,
                    skippedBlocks: 0,
                    errorBlocks: 0,
                    retries: 0,
                    cached: true,
                    durationMs: 0,
                    errors: [],
                });
                markWorked(fileName, '(캐시 사용)');
            } else {
                delete options.cache[cacheKey];
                saveCache(options.edir, options.cache);
                failedFiles.push(fileName);
                entries.push(createFailureLogEntry(fileName, validation.errors, true));
                markWorked(fileName, '(캐시 검증 실패)');
            }
            continue;
        }

        pending.push({ fileName, fileOrdinal, originalContent, cacheKey });
    }

    await runTranslationQueue(pending, options.workerCount, options.isAborted, async (task) => {
        options.onStatus?.(`[${task.fileOrdinal}/${options.fileList.length}] ${task.fileName}`);
        return translateOneFile(task, options, () => workedFiles);
    }, (result) => {
        const filePath = path.join(options.edir, result.fileName);
        if (result.aborted) {
            return;
        }

        const fileValidation = validateTranslatedFileContent(
            result.originalContent,
            result.translatedContent,
            result.validation,
        );
        const translationSucceeded = result.translatedContent !== result.originalContent && fileValidation.ok;

        totalErrors += result.validation.filter((b) => !b.lineCountMatch || !b.separatorMatch).length;
        totalBlocks += result.validation.length;

        if (translationSucceeded) {
            atomicWriteTextFile(filePath, result.translatedContent, { encoding: 'utf-8' });
            options.cache[result.cacheKey] = {
                translatedContent: result.translatedContent,
                model: options.model,
                targetLang: options.targetLang,
                provider: options.provider,
            };
            saveCache(options.edir, options.cache);
            options.completedFiles.add(result.fileName);
            saveProgressState();
        } else {
            failedFiles.push(result.fileName);
        }

        entries.push({
            timestamp: new Date().toISOString(),
            fileName: result.fileName,
            cached: false,
            ...result.logEntry,
            errors: [
                ...((result.logEntry.errors as string[] | undefined) || []),
                ...(translationSucceeded ? [] : (fileValidation.errors.length ? fileValidation.errors : ['번역 결과가 원본과 동일합니다'])),
            ],
        } as TranslationLogEntry);
        markWorked(result.fileName, translationSucceeded ? '' : '(검증 실패)');
    }, (task, err) => {
        if (options.isAborted()) {
            return;
        }
        failedFiles.push(task.fileName);
        entries.push(createFailureLogEntry(task.fileName, [String((err as Error).message || err)], false));
        markWorked(task.fileName, '(번역 실패)');
    });

    return { workedFiles, failedFiles, totalErrors, totalBlocks, entries };
}

async function translateOneFile(
    task: PendingTranslationFile,
    options: TranslationCoordinatorOptions,
    getWorkedFiles: () => number,
): Promise<TranslationFileResult> {
    const started = Date.now();
    const translator = options.createTranslatorForFile
        ? options.createTranslatorForFile(task.fileName)
        : createTranslator(options.settings, options.sourceLang, options.targetLang, options.isAborted);
    const result = await translator.translateFileContent(
        task.originalContent,
        (current, total, detail) => {
            const fileProgress = (getWorkedFiles() / options.fileList.length) * 100;
            const blockProgress = total > 0 ? (current / total) * (100 / options.fileList.length) : 0;
            options.onProgress?.(fileProgress + blockProgress);
            options.onStatus?.(`[${task.fileOrdinal}/${options.fileList.length}] ${task.fileName} — ${detail} (${current}/${total} 블록)`);
        },
    );

    return {
        ...task,
        translatedContent: result.translatedContent,
        validation: result.validation,
        logEntry: result.logEntry,
        aborted: !!result.aborted,
        durationMs: Date.now() - started,
    };
}

async function runTranslationQueue<T, R>(
    tasks: T[],
    workerCount: number,
    isAborted: () => boolean,
    worker: (task: T) => Promise<R>,
    onSuccess: (result: R) => void,
    onFailure: (task: T, err: unknown) => void,
): Promise<void> {
    return new Promise((resolve) => {
        let nextIndex = 0;
        let active = 0;

        const launch = () => {
            while (active < workerCount && nextIndex < tasks.length && !isAborted()) {
                const task = tasks[nextIndex++];
                active++;
                worker(task).then(onSuccess, (err) => onFailure(task, err)).finally(() => {
                    active--;
                    if ((nextIndex >= tasks.length || isAborted()) && active === 0) {
                        resolve();
                    } else {
                        launch();
                    }
                });
            }
            if ((nextIndex >= tasks.length || isAborted()) && active === 0) {
                resolve();
            }
        };

        launch();
    });
}

function createFailureLogEntry(fileName: string, errors: string[], cached: boolean): TranslationLogEntry {
    return {
        timestamp: new Date().toISOString(),
        fileName,
        totalBlocks: 0,
        translatedBlocks: 0,
        skippedBlocks: 0,
        errorBlocks: 1,
        retries: 0,
        cached,
        durationMs: 0,
        errors,
    };
}

function extractControlCodes(line: string): string[] {
    return line.match(CONTROL_CODE_REGEX) || [];
}

function sameStringArray(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

export const trans = async (ev: unknown, arg: TransArg, ctx: AppContext) => {
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
        const readinessError = getLlmReadinessError(ctx.settings);
        if (readinessError) {
            Tools.sendError(readinessError);
            Tools.send('llmTranslating', false);
            Tools.worked();
            return;
        }

        const targetLang = ctx.settings.llmTargetLang || 'ko';
        const sourceLang = arg.langu || 'ja';
        const provider = normalizeLlmProvider(ctx.settings.llmProvider);
        const fileList = fs.readdirSync(edir).filter(f => f.endsWith('.txt'));

        if (fileList.length === 0) {
            Tools.sendError('Extract 폴더에 번역할 .txt 파일이 없습니다');
            Tools.send('llmTranslating', false);
            Tools.worked();
            return;
        }

        await runWithDirectoryLock(edir, async () => {
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
                                    const cacheKey = buildTranslationCacheKey(provider, hash, ctx.settings.llmModel, targetLang);
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
            const model = ctx.settings.llmModel;
            const workerCount = resolveLlmParallelWorkers(provider, arg.parallelWorkers ?? ctx.settings.llmParallelWorkers);

            // Log
            const translationLog: TranslationLog = {
                startTime: new Date().toISOString(),
                endTime: '',
                provider,
                model,
                sourceLang,
                targetLang,
                totalFiles: fileList.length,
                totalDurationMs: 0,
                entries: []
            };
            const startTime = Date.now();

            const result = await translateFilesWithCoordinator({
                edir,
                backupDir,
                fileList,
                completedFiles,
                cache,
                provider,
                model,
                sourceLang,
                targetLang,
                settings: ctx.settings,
                translationMode,
                isResuming,
                workerCount,
                isAborted: () => ctx.llmAbort,
                onProgress: (pct) => Tools.send('loading', pct),
                onStatus: (message) => Tools.send('loadingTag', message),
            });
            translationLog.entries.push(...result.entries);

            // Finalize
            const aborted = !!ctx.llmAbort;
            if (!aborted) clearProgress(edir);
            translationLog.endTime = new Date().toISOString();
            translationLog.totalDurationMs = Date.now() - startTime;
            const logFile = writeTranslationLog(edir, translationLog);

            Tools.send('loading', 0);
            Tools.send('loadingTag', '');

            const durationSec = Math.round(translationLog.totalDurationMs / 1000);
            const cacheNote = translationLog.entries.filter(e => e.cached).length;
            const cacheMsg = cacheNote > 0 ? `\n캐시 사용: ${cacheNote}개 파일` : '';
            const failMsg = result.failedFiles.length > 0
                ? `\n번역 실패: ${result.failedFiles.length}개 파일 (${result.failedFiles.slice(0, 5).join(', ')}${result.failedFiles.length > 5 ? ' ...' : ''})`
                : '';
            const workerMsg = workerCount > 1 ? `\n동시 번역 파일 수: ${workerCount}` : '';
            if (aborted) {
                Tools.sendAlert(
                    `번역 중단 (${result.workedFiles}/${fileList.length} 파일 처리, ${durationSec}초 소요)${failMsg}${workerMsg}`
                );
            } else {
                const resumeNote = isResuming ? `\n(이전 진행 상태에서 재개됨)` : '';
                Tools.sendAlert(
                    `번역 완료! (${durationSec}초 소요)\n백업: ${backupDir}\n로그: ${path.basename(logFile)}${resumeNote}${cacheMsg}${failMsg}${workerMsg}`
                );
            }
        });
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
    ctx: AppContext,
    onProgress?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
    const backupDir = edir + BACKUP_SUFFIX;
    const backupPath = path.join(backupDir, fileName);
    const filePath = path.join(edir, fileName);

    if (!fs.existsSync(backupPath)) {
        return { success: false, error: '백업 파일이 존재하지 않습니다' };
    }

    const readinessError = getLlmReadinessError(ctx.settings);
    if (readinessError) {
        return { success: false, error: readinessError };
    }

    const originalContent = fs.readFileSync(backupPath, 'utf-8');
    const provider = normalizeLlmProvider(ctx.settings.llmProvider);
    const translator = createTranslator(ctx.settings, sourceLang, targetLang, () => ctx.llmAbort);
    const model = ctx.settings.llmModel;

    // Invalidate cache for this file's original content and persist immediately
    const cache = loadCache(edir);
    const hash = contentHash(originalContent);
    const cacheKey = buildTranslationCacheKey(provider, hash, model, targetLang);
    delete cache[cacheKey];
    saveCache(edir, cache);

    onProgress?.('번역 중...');

    const { translatedContent, validation, logEntry } = await translator.translateFileContent(
        originalContent,
        (current, total, detail) => {
            onProgress?.(`${detail} (${current}/${total} 블록)`);
        }
    );

    // Check if translation actually produced different content
    const fileValidation = validateTranslatedFileContent(originalContent, translatedContent, validation);
    if (translatedContent === originalContent || !fileValidation.ok) {
        const errors = (logEntry.errors as string[]) || [];
        const reason = errors.length > 0 ? errors[0] : (fileValidation.errors[0] || '번역 결과가 원본과 동일합니다');
        return { success: false, error: reason };
    }

    atomicWriteTextFile(filePath, translatedContent, { encoding: 'utf-8' });

    cache[cacheKey] = { translatedContent, model, targetLang, provider };
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
    ctx: AppContext,
    onProgress?: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
    const backupDir = edir + BACKUP_SUFFIX;
    const backupPath = path.join(backupDir, fileName);
    const filePath = path.join(edir, fileName);

    if (!fs.existsSync(backupPath)) {
        return { success: false, error: '백업 파일이 존재하지 않습니다' };
    }

    const readinessError = getLlmReadinessError(ctx.settings);
    if (readinessError) {
        return { success: false, error: readinessError };
    }

    const originalContent = fs.readFileSync(backupPath, 'utf-8');
    const transContent = fs.readFileSync(filePath, 'utf-8');
    const provider = normalizeLlmProvider(ctx.settings.llmProvider);
    const translator = createTranslator(ctx.settings, sourceLang, targetLang, () => ctx.llmAbort);

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
        let translated = await translator.translateText(textToTranslate);
        if (textToTranslate.endsWith('\n') && !translated.endsWith('\n')) {
            translated += '\n';
        }

        // Split translated result back into blocks
        const translatedBlocks = splitFileBlocks(translated.split('\n'));

        // Replace or insert the selected blocks in the translated file
        for (let i = 0; i < blockIndices.length; i++) {
            const idx = blockIndices[i];
            if (i >= translatedBlocks.length) break;
            if (idx < transBlocks.length) {
                transBlocks[idx] = translatedBlocks[i];
            } else {
                // Block missing in translation — insert at the end
                transBlocks.push(translatedBlocks[i]);
            }
        }

        // Reassemble and write
        const outParts: string[] = [];
        for (const block of transBlocks) {
            if (block.separator) outParts.push(block.separator);
            outParts.push(...block.lines);
        }
        atomicWriteTextFile(filePath, outParts.join('\n'), { encoding: 'utf-8' });

        // Invalidate cache
        const cache = loadCache(edir);
        const hash = contentHash(originalContent);
        const model = ctx.settings.llmModel;
        const cacheKey = buildTranslationCacheKey(provider, hash, model, targetLang);
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
