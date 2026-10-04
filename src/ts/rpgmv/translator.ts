import path from 'path';
import fs from 'fs';
import Tools from '../libs/projectTools';
import { AppContext } from '../../appContext';
import {
    TranslationLog,
    TranslationLogEntry,
    contentHash,
    reassembleBlocks,
    splitFileBlocks,
    validateChunk,
} from '../libs/translationCore';
export { splitFileBlocks } from '../libs/translationCore';
import { isTranslationTextFileName } from '../libs/translationSyntax';
import { validateTranslatedFileContent, type TranslationOutcome } from '../libs/translationResult';
export { validateTranslatedFileContent, type FileValidationResult } from '../libs/translationResult';
import { atomicWriteJsonFile, atomicWriteTextFile, cleanupStaleAtomicTempFilesForPaths } from '../libs/atomicFile';
import { runWithDirectoryLock } from '../libs/concurrency';
import { LLM_FINGERPRINT_SCHEMA_VERSION } from '../libs/providerRegistry';
import { normalizeTranslationConcurrency, TranslationRequestScheduler } from '../libs/translationRequestScheduler';
import {
    buildTranslationCacheKey,
    buildTranslationConfigFingerprint,
    createTranslator,
    getLlmReadinessError,
    normalizeLlmProvider,
    type Translator,
} from '../libs/translatorFactory';

import { TranslationCache, type CacheStore } from '../libs/translationCache';

const PROGRESS_FILE = '.llm_progress.json';

const BACKUP_SUFFIX = '_backup';

export interface ProgressState {
    version: number;
    fingerprint: string;
    completedFiles: string[];
    timestamp: string;
}

/** Establish the complete original surface before an optional reset changes any translation. */
export async function createTranslationBackup(edir: string, restoreOriginals = false): Promise<string> {
    const backupDir = edir + BACKUP_SUFFIX;
    const files = fs.readdirSync(edir).filter(isTranslationTextFileName).sort();
    if (files.length === 0) {
        throw new Error('백업할 번역 파일이 없습니다');
    }
    if (fs.existsSync(backupDir)) {
        const backupFiles = fs.readdirSync(backupDir).filter(isTranslationTextFileName).sort();
        if (files.length !== backupFiles.length || files.some((file, index) => file !== backupFiles[index])) {
            throw new Error('Extract_backup이 불완전하거나 현재 Extract와 일치하지 않습니다. 백업을 확인한 뒤 재시도해 주세요');
        }
        if (restoreOriginals) restoreTranslationBackup(edir, backupDir, files);
        return backupDir;
    }

    const stagingDir = fs.mkdtempSync(`${backupDir}.staging-`);
    try {
        for (let i = 0; i < files.length; i++) {
            fs.copyFileSync(path.join(edir, files[i]), path.join(stagingDir, files[i]));
            // Yield to event loop every 50 files to prevent Chromium watchdog kill
            if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }
        fs.renameSync(stagingDir, backupDir);
    } catch (error) {
        if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        throw error;
    }
    return backupDir;
}

function restoreTranslationBackup(edir: string, backupDir: string, files: string[]): void {
    // Read every input before changing anything; the original backup is never
    // removed or regenerated from partially restored translation files.
    const replacements = files.map((file) => {
        const target = path.join(edir, file);
        return {
            target,
            original: fs.readFileSync(target, 'utf-8'),
            restored: fs.readFileSync(path.join(backupDir, file), 'utf-8'),
            mode: fs.statSync(target).mode,
        };
    });
    const committed: typeof replacements = [];
    try {
        for (const replacement of replacements) {
            if (replacement.original === replacement.restored) continue;
            atomicWriteTextFile(replacement.target, replacement.restored, {
                expectedContent: replacement.original, mode: replacement.mode,
            });
            committed.push(replacement);
        }
    } catch (error) {
        const rollbackErrors: string[] = [];
        for (const replacement of committed.reverse()) {
            try {
                atomicWriteTextFile(replacement.target, replacement.original, {
                    expectedContent: replacement.restored, mode: replacement.mode,
                });
            } catch {
                rollbackErrors.push(path.basename(replacement.target));
            }
        }
        if (rollbackErrors.length) {
            throw new Error(`번역 초기화와 일부 복구에 실패했습니다 (${rollbackErrors.join(', ')}). 원문 백업은 보존되었습니다.`, { cause: error });
        }
        throw error;
    }
}

function loadProgress(edir: string): ProgressState | null {
    const pfile = path.join(edir, PROGRESS_FILE);
    if (fs.existsSync(pfile)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(pfile, 'utf-8')) as Partial<ProgressState>;
            if (!parsed || !Array.isArray(parsed.completedFiles)) return null;
            return {
                version: typeof parsed.version === 'number' ? parsed.version : 0,
                fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
                completedFiles: parsed.completedFiles.filter((file): file is string => typeof file === 'string'),
                timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : '',
            };
        } catch { return null; }
    }
    return null;
}

function saveProgress(edir: string, state: ProgressState, cleanupStaleTempFiles = true) {
    atomicWriteJsonFile(path.join(edir, PROGRESS_FILE), state, 2, { cleanupStaleTempFiles });
}

function clearProgress(edir: string) {
    const pfile = path.join(edir, PROGRESS_FILE);
    if (fs.existsSync(pfile)) fs.unlinkSync(pfile);
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
    outcome: TranslationOutcome;
}

export interface TranslationCoordinatorOptions {
    edir: string;
    backupDir: string;
    fileList: string[];
    completedFiles: Set<string>;
    cache?: CacheStore;
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

export function isMatchingTranslationProgress(progress: ProgressState | null, fingerprint: string): boolean {
    return progress?.version === LLM_FINGERPRINT_SCHEMA_VERSION
        && progress.fingerprint === fingerprint;
}

function removeFileFromProgress(edir: string, fileName: string, fingerprint: string): void {
    const progress = loadProgress(edir);
    if (!progress) return;
    if (!isMatchingTranslationProgress(progress, fingerprint)) {
        clearProgress(edir);
        return;
    }
    progress.completedFiles = progress.completedFiles.filter((file) => file !== fileName);
    saveProgress(edir, progress);
}

export function resolveLlmParallelWorkers(_provider: string, requested: unknown): number {
    return normalizeTranslationConcurrency(requested);
}

export async function translateFilesWithCoordinator(options: TranslationCoordinatorOptions): Promise<TranslationCoordinatorResult> {
    const entries: TranslationLogEntry[] = [];
    const failedFiles: string[] = [];
    const cache = new TranslationCache(options.edir, options.cache);
    cleanupStaleAtomicTempFilesForPaths([
        ...options.fileList.map(file => path.join(options.edir, file)), path.join(options.edir, PROGRESS_FILE),
    ]);
    let sharedTranslator: Translator | undefined;
    let workedFiles = 0;
    let totalErrors = 0;
    let totalBlocks = 0;
    let executionFailure: { error: unknown } | undefined;
    const scheduler = new TranslationRequestScheduler({
        concurrency: options.workerCount,
        requestsPerMinute: options.settings.llmRequestsPerMinute,
        isAborted: options.isAborted,
    });
    const fileProgress = new Map<string, number>();
    const reportProgress = () => {
        const partial = [...fileProgress.values()].reduce((sum, value) => sum + value, 0);
        options.onProgress?.(((workedFiles + partial) / Math.max(1, options.fileList.length)) * 100);
    };
    const configFingerprint = buildTranslationConfigFingerprint(
        options.provider,
        options.model,
        options.sourceLang,
        options.targetLang,
        options.settings,
    );

    const saveProgressState = () => saveProgress(options.edir, {
        version: LLM_FINGERPRINT_SCHEMA_VERSION,
        fingerprint: configFingerprint,
        completedFiles: [...options.completedFiles],
        timestamp: new Date().toISOString(),
    }, false);

    const markWorked = (fileName: string, detail: string) => {
        fileProgress.delete(fileName);
        workedFiles++;
        reportProgress();
        options.onStatus?.(`${fileName} ${detail}`);
    };

    const prepareFile = (fileName: string, fileOrdinal: number): PendingTranslationFile | undefined => {
        if (options.isAborted()) {
            return;
        }

        if (options.isResuming && options.completedFiles.has(fileName)) {
            markWorked(fileName, '(이전 번역 건너뜀)');
            return;
        }

        const filePath = path.join(options.edir, fileName);
        const originalContent = fs.readFileSync(filePath, 'utf-8');

        if (options.translationMode === 'untranslated') {
            const backupPath = path.join(options.backupDir, fileName);
            if (fs.existsSync(backupPath)) {
                const backupContent = fs.readFileSync(backupPath, 'utf-8');
                if (originalContent !== backupContent) {
                    options.completedFiles.add(fileName);
                    saveProgressState();
                    markWorked(fileName, '(번역됨, 건너뜀)');
                    return;
                }
            }
        }

        const hash = contentHash(originalContent);
        const cacheKey = buildTranslationCacheKey(
            options.provider,
            hash,
            options.model,
            options.sourceLang,
            options.targetLang,
            options.settings,
        );
        const cached = cache.get(cacheKey);
        if (cached) {
            const validation = validateTranslatedFileContent(originalContent, cached.translatedContent);
            if (validation.ok) {
                if (!fileStillMatches(filePath, originalContent)) {
                    failedFiles.push(fileName);
                    entries.push(createFailureLogEntry(fileName, ['번역 중 파일이 변경되어 캐시 결과를 반영하지 않았습니다'], true));
                    markWorked(fileName, '(파일 변경, 건너뜀)');
                    return;
                }
                atomicWriteTextFile(filePath, cached.translatedContent, { encoding: 'utf-8', expectedContent: originalContent, cleanupStaleTempFiles: false });
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
                return;
            } else {
                cache.delete(cacheKey);
                options.onStatus?.(`${fileName} (캐시 검증 실패, 새 번역 대기)`);
            }
        }

        return { fileName, fileOrdinal, originalContent, cacheKey };
    };

    const pending = options.fileList.map((fileName, index) => ({ fileName, fileOrdinal: index + 1 }));
    await runTranslationQueue(pending, scheduler.concurrency, () => scheduler.isAborted(), async (queued) => {
        let task: PendingTranslationFile | undefined;
        try {
            task = prepareFile(queued.fileName, queued.fileOrdinal);
            if (!task) return;
            options.onStatus?.(`[${task.fileOrdinal}/${options.fileList.length}] ${task.fileName}`);
        } catch (error) {
            executionFailure ??= { error };
            scheduler.cancel();
            throw error;
        }
        const translator = options.createTranslatorForFile
            ? options.createTranslatorForFile(task.fileName)
            : sharedTranslator ??= createTranslator(options.settings, options.sourceLang, options.targetLang, options.isAborted);
        const fileName = task.fileName;
        return translateOneFile(task, options, scheduler, (current, total) => {
            const fraction = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
            fileProgress.set(fileName, Math.max(fileProgress.get(fileName) ?? 0, fraction));
            reportProgress();
        }, translator);
    }, (result) => {
        if (!result) return;
        const filePath = path.join(options.edir, result.fileName);
        const outcome = result.outcome;
        if (outcome.status === 'aborted') return;
        const stalePreimage = !fileStillMatches(filePath, result.originalContent);
        const translationSucceeded = outcome.status !== 'failed' && !stalePreimage;

        const structuralErrorBlocks = outcome.validation.filter((b) => !b.lineCountMatch || !b.separatorMatch).length;
        totalErrors += Math.max(structuralErrorBlocks, outcome.logEntry.errorBlocks);
        totalBlocks += outcome.validation.length;

        if (translationSucceeded) {
            if (outcome.translatedContent !== result.originalContent) {
                atomicWriteTextFile(filePath, outcome.translatedContent, { encoding: 'utf-8', expectedContent: result.originalContent, cleanupStaleTempFiles: false });
            }
            cache.set(result.cacheKey, {
                translatedContent: outcome.translatedContent,
                model: options.model,
                targetLang: options.targetLang,
                provider: options.provider,
            });
            options.completedFiles.add(result.fileName);
            saveProgressState();
        } else {
            failedFiles.push(result.fileName);
        }

        entries.push({
            timestamp: new Date().toISOString(),
            fileName: result.fileName,
            cached: false,
            ...outcome.logEntry,
            errors: [
                ...outcome.logEntry.errors,
                ...(stalePreimage ? ['번역 중 파일이 변경되어 결과를 반영하지 않았습니다']
                    : outcome.status === 'failed' ? [outcome.error] : []),
            ],
        });
        markWorked(result.fileName, translationSucceeded ? '' : stalePreimage ? '(파일 변경, 건너뜀)' : '(검증 실패)');
    }, (task, err) => {
        if (scheduler.isAborted()) {
            if (!options.isAborted()) executionFailure ??= { error: err };
            return;
        }
        failedFiles.push(task.fileName);
        entries.push(createFailureLogEntry(task.fileName, [String((err as Error).message || err)], false));
        markWorked(task.fileName, '(번역 실패)');
    }, () => scheduler.cancel());

    if (executionFailure) throw executionFailure.error;

    return { workedFiles, failedFiles, totalErrors, totalBlocks, entries };
}

function fileStillMatches(filePath: string, expectedContent: string): boolean {
    try {
        return fs.readFileSync(filePath, 'utf-8') === expectedContent;
    } catch {
        return false;
    }
}

async function translateOneFile(
    task: PendingTranslationFile,
    options: TranslationCoordinatorOptions,
    scheduler: TranslationRequestScheduler,
    onProgress: (current: number, total: number) => void,
    translator: Translator,
): Promise<TranslationFileResult> {
    const result = await translator.translateFileContent(
        task.originalContent,
        (current, total, detail) => {
            onProgress(current, total);
            options.onStatus?.(`[${task.fileOrdinal}/${options.fileList.length}] ${task.fileName} — ${detail} (${current}/${total} 블록)`);
        },
        { scheduler },
    );

    return { ...task, outcome: result };
}

async function runTranslationQueue<T, R>(
    tasks: T[],
    workerCount: number,
    isAborted: () => boolean,
    worker: (task: T) => Promise<R>,
    onSuccess: (result: R) => void,
    onFailure: (task: T, err: unknown) => void,
    onStopped?: () => void,
): Promise<void> {
    let nextIndex = 0;
    let failure: { error: unknown } | undefined;
    const runWorker = async () => {
        try {
            while (nextIndex < tasks.length && !isAborted() && !failure) {
                const task = tasks[nextIndex++];
                let result: R;
                try {
                    result = await worker(task);
                } catch (error) {
                    onFailure(task, error);
                    continue;
                }
                onSuccess(result);
            }
        } catch (error) {
            failure ??= { error };
            onStopped?.();
        }
    };

    // Completion callback failures stop the queue, but in-flight work must settle
    // before the caller can release its directory lock or start another run.
    await Promise.all(Array.from({ length: Math.min(workerCount, tasks.length) }, runWorker));
    if (failure) throw failure.error;
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
        const sourceLang = arg.langu || ctx.settings.llmSourceLang || 'ja';
        const provider = normalizeLlmProvider(ctx.settings.llmProvider);
        const model = ctx.settings.llmModel;
        const configFingerprint = buildTranslationConfigFingerprint(
            provider,
            model,
            sourceLang,
            targetLang,
            ctx.settings,
        );
        const fileList = fs.readdirSync(edir).filter(isTranslationTextFileName);

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
            } else if (sortOrder === 'size-asc' || sortOrder === 'size-desc') {
                const sizes = new Map(fileList.map(file => [file, fs.statSync(path.join(edir, file)).size]));
                const direction = sortOrder === 'size-asc' ? 1 : -1;
                fileList.sort((a, b) => direction * (sizes.get(a)! - sizes.get(b)!));
            } else {
                fileList.sort((a, b) => a.localeCompare(b));
            }

            // Auto-backup
            Tools.send('loadingTag', '백업 생성 중...');
            const translationMode = arg.translationMode || 'untranslated';
            const backupDir = await createTranslationBackup(edir, !!arg.resetProgress && translationMode === 'all');
            const cache = new TranslationCache(edir);

            // Reset if requested: restore originals from backup, clear progress/cache
            if (arg.resetProgress) {
                if (translationMode === 'all') {
                    // Restore succeeded before any progress/cache state is cleared.
                    clearProgress(edir);
                    cache.clear();
                } else {
                    // Untranslated-only reset: keep translated files, only clear progress
                    // and invalidate cache for untranslated files so they get fresh translations
                    clearProgress(edir);
                    if (fs.existsSync(backupDir)) {
                        const backupFiles = fs.readdirSync(backupDir).filter(isTranslationTextFileName);
                        for (const f of backupFiles) {
                            const filePath = path.join(edir, f);
                            const backupPath = path.join(backupDir, f);
                            if (fs.existsSync(filePath)) {
                                const fileContent = fs.readFileSync(filePath, 'utf-8');
                                const backupContent = fs.readFileSync(backupPath, 'utf-8');
                                if (fileContent === backupContent) {
                                    // Untranslated file — invalidate its cache entry
                                    const hash = contentHash(backupContent);
                                    const cacheKey = buildTranslationCacheKey(
                                        provider,
                                        hash,
                                        model,
                                        sourceLang,
                                        targetLang,
                                        ctx.settings,
                                    );
                                    cache.delete(cacheKey);
                                }
                            }
                        }
                    }
                }
            }

            // Resume state
            const prevProgress = loadProgress(edir);
            const matchingProgress = isMatchingTranslationProgress(prevProgress, configFingerprint);
            if (prevProgress && !matchingProgress) clearProgress(edir);
            const completedFiles = new Set(matchingProgress ? prevProgress!.completedFiles : []);
            const isResuming = completedFiles.size > 0;

            // Cache
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
            const workerMsg = workerCount > 1 ? `\n동시 API 요청 수: ${workerCount}` : '';
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

export function retranslateFile(
    edir: string,
    fileName: string,
    sourceLang: string,
    targetLang: string,
    ctx: AppContext,
    onProgress?: (msg: string) => void,
    expectedContent?: string,
    isCurrent: () => boolean = () => true,
): Promise<{ success: boolean; error?: string }> {
    return runWithDirectoryLock(edir, () => retranslateFileUnlocked(
        edir,
        fileName,
        sourceLang,
        targetLang,
        ctx,
        onProgress,
        expectedContent,
        isCurrent,
    ));
}

async function retranslateFileUnlocked(
    edir: string,
    fileName: string,
    sourceLang: string,
    targetLang: string,
    ctx: AppContext,
    onProgress?: (msg: string) => void,
    expectedContent?: string,
    isCurrent: () => boolean = () => true,
): Promise<{ success: boolean; error?: string }> {
    if (!isCurrent()) return { success: false, error: '프로젝트가 변경되어 재번역을 중단했습니다' };
    ctx.llmAbort = false;
    const backupDir = edir + BACKUP_SUFFIX;
    const backupPath = path.join(backupDir, fileName);
    const filePath = path.join(edir, fileName);

    if (!fs.existsSync(backupPath)) {
        return { success: false, error: '백업 파일이 존재하지 않습니다' };
    }
    if (!fs.existsSync(filePath)) {
        return { success: false, error: '번역 파일이 존재하지 않습니다' };
    }

    const translationPreimage = expectedContent ?? fs.readFileSync(filePath, 'utf-8');
    if (fs.readFileSync(filePath, 'utf-8') !== translationPreimage) {
        return { success: false, error: '재번역 요청 후 파일이 변경되어 중단했습니다' };
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
    const cache = new TranslationCache(edir);
    const hash = contentHash(originalContent);
    const configFingerprint = buildTranslationConfigFingerprint(
        provider,
        model,
        sourceLang,
        targetLang,
        ctx.settings,
    );
    const cacheKey = buildTranslationCacheKey(
        provider,
        hash,
        model,
        sourceLang,
        targetLang,
        ctx.settings,
    );
    cache.delete(cacheKey);

    onProgress?.('번역 중...');
    if (!isCurrent()) return { success: false, error: '프로젝트가 변경되어 재번역을 중단했습니다' };

    const outcome = await translator.translateFileContent(
        originalContent,
        (current, total, detail) => {
            onProgress?.(`${detail} (${current}/${total} 블록)`);
        }
    );

    if (outcome.status === 'aborted') return { success: false, error: '번역이 중단되었습니다' };
    if (outcome.status === 'failed') return { success: false, error: outcome.error };
    const { translatedContent } = outcome;

    // A provider response can arrive long after the request. Never overwrite
    // edits made while it was in flight.
    if (!isCurrent()) return { success: false, error: '프로젝트가 변경되어 재번역 결과를 반영하지 않았습니다' };
    if (fs.readFileSync(filePath, 'utf-8') !== translationPreimage) {
        return { success: false, error: '재번역 중 파일이 변경되어 결과를 반영하지 않았습니다' };
    }

    if (translatedContent !== originalContent) {
        atomicWriteTextFile(filePath, translatedContent, { encoding: 'utf-8', expectedContent: translationPreimage });
    }

    cache.set(cacheKey, { translatedContent, model, targetLang, provider });

    // Remove from progress so it can be re-translated in bulk runs too
    removeFileFromProgress(edir, fileName, configFingerprint);

    return { success: true };
}

export function retranslateBlocks(
    edir: string,
    fileName: string,
    blockIndices: number[],
    sourceLang: string,
    targetLang: string,
    ctx: AppContext,
    onProgress?: (msg: string) => void,
    expectedContent?: string,
    isCurrent: () => boolean = () => true,
): Promise<{ success: boolean; error?: string }> {
    return runWithDirectoryLock(edir, () => retranslateBlocksUnlocked(
        edir,
        fileName,
        blockIndices,
        sourceLang,
        targetLang,
        ctx,
        onProgress,
        expectedContent,
        isCurrent,
    ));
}

async function retranslateBlocksUnlocked(
    edir: string,
    fileName: string,
    blockIndices: number[],
    sourceLang: string,
    targetLang: string,
    ctx: AppContext,
    onProgress?: (msg: string) => void,
    expectedContent?: string,
    isCurrent: () => boolean = () => true,
): Promise<{ success: boolean; error?: string }> {
    if (!isCurrent()) return { success: false, error: '프로젝트가 변경되어 재번역을 중단했습니다' };
    ctx.llmAbort = false;
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

    if (!fs.existsSync(filePath)) {
        return { success: false, error: '번역 파일이 존재하지 않습니다' };
    }

    const originalContent = fs.readFileSync(backupPath, 'utf-8');
    const transContent = fs.readFileSync(filePath, 'utf-8');
    if (expectedContent !== undefined && transContent !== expectedContent) {
        return { success: false, error: '재번역 요청 후 파일이 변경되어 중단했습니다' };
    }
    const provider = normalizeLlmProvider(ctx.settings.llmProvider);
    const translator = createTranslator(ctx.settings, sourceLang, targetLang, () => ctx.llmAbort);

    // Split both files into blocks
    const origLines = originalContent.split('\n');
    const transLines = transContent.split('\n');
    const origBlocks = splitFileBlocks(origLines);
    const transBlocks = splitFileBlocks(transLines);

    if (blockIndices.length === 0) {
        return { success: false, error: '재번역할 블록이 없습니다' };
    }
    if (blockIndices.some((index) => !Number.isInteger(index) || index < 0)) {
        return { success: false, error: '유효하지 않은 블록 번호가 포함되어 있습니다' };
    }
    if (new Set(blockIndices).size !== blockIndices.length) {
        return { success: false, error: '중복된 블록 번호가 포함되어 있습니다' };
    }
    if (blockIndices.some((index) => index >= origBlocks.length || index >= transBlocks.length)) {
        return { success: false, error: '원본 또는 번역 파일에 존재하지 않는 블록입니다' };
    }

    // Collect original blocks to retranslate in the exact UI-selected order.
    const toTranslate = blockIndices.map((index) => origBlocks[index]);

    // Reassemble selected blocks into text for translation
    const textToTranslate = reassembleBlocks(toTranslate);

    onProgress?.(`${blockIndices.length}개 블록 번역 중...`);
    if (!isCurrent()) return { success: false, error: '프로젝트가 변경되어 재번역을 중단했습니다' };

    try {
        const scheduler = new TranslationRequestScheduler({ isAborted: () => ctx.llmAbort });
        let translated = await scheduler.run(() => translator.translateText(textToTranslate, scheduler.signal));
        if (scheduler.isAborted()) return { success: false, error: '번역이 중단되었습니다' };
        if (textToTranslate.endsWith('\n') && !translated.endsWith('\n')) {
            translated += '\n';
        }

        // Split translated result back into blocks
        const translatedBlocks = splitFileBlocks(translated.split('\n'));
        if (translatedBlocks.length !== toTranslate.length) {
            return {
                success: false,
                error: `번역 블록 수가 변경되었습니다 (${toTranslate.length} -> ${translatedBlocks.length})`,
            };
        }

        const selectedValidation = validateChunk(toTranslate, translated);
        const selectedFileValidation = validateTranslatedFileContent(
            textToTranslate,
            translated,
            selectedValidation.blockValidations,
        );
        if (!selectedFileValidation.ok) {
            return { success: false, error: selectedFileValidation.errors[0] || '선택 블록 검증에 실패했습니다' };
        }

        // Replace the selected blocks only after the complete response validates.
        const candidateBlocks = transBlocks.map((block) => ({
            separator: block.separator,
            lines: [...block.lines],
        }));
        for (let i = 0; i < blockIndices.length; i++) {
            const idx = blockIndices[i];
            candidateBlocks[idx] = {
                separator: translatedBlocks[i].separator,
                lines: [...translatedBlocks[i].lines],
            };
        }

        const candidateContent = reassembleBlocks(candidateBlocks);
        const candidateValidation = validateTranslatedFileContent(originalContent, candidateContent);
        if (!candidateValidation.ok) {
            return { success: false, error: candidateValidation.errors[0] || '최종 파일 검증에 실패했습니다' };
        }

        // Preserve edits made after the provider request started.
        if (!isCurrent()) return { success: false, error: '프로젝트가 변경되어 재번역 결과를 반영하지 않았습니다' };
        if (fs.readFileSync(filePath, 'utf-8') !== transContent) {
            return { success: false, error: '재번역 중 파일이 변경되어 결과를 반영하지 않았습니다' };
        }

        atomicWriteTextFile(filePath, candidateContent, { encoding: 'utf-8', expectedContent: transContent });

        // Invalidate cache
        const cache = new TranslationCache(edir);
        const hash = contentHash(originalContent);
        const model = ctx.settings.llmModel;
        const configFingerprint = buildTranslationConfigFingerprint(
            provider,
            model,
            sourceLang,
            targetLang,
            ctx.settings,
        );
        const cacheKey = buildTranslationCacheKey(
            provider,
            hash,
            model,
            sourceLang,
            targetLang,
            ctx.settings,
        );
        cache.delete(cacheKey);
        removeFileFromProgress(edir, fileName, configFingerprint);

        return { success: true };
    } catch (err: unknown) {
        return { success: false, error: (err as Error).message || String(err) };
    }
}
