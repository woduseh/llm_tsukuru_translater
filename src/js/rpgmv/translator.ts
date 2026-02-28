import path from 'path';
import fs from 'fs';
import { BrowserWindow } from 'electron';
import { createGeminiTranslator, CompareData, TranslationValidation, TranslationLog, TranslationLogEntry, contentHash } from '../libs/geminiTranslator';

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

function createBackup(edir: string): string {
    const backupDir = edir + BACKUP_SUFFIX;
    if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
    fs.cpSync(edir, backupDir, { recursive: true });
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

export const trans = async (ev, arg) => {
    try {
        const dir = Buffer.from(arg.dir, "base64").toString('utf8');
        const edir = arg.game === 'wolf' ? path.join(dir, '_Extract', 'Texts') : path.join(dir, 'Extract');
        if (!fs.existsSync(edir)) {
            globalThis.mwindow.webContents.send('alert', { icon: 'error', message: 'Extract 폴더가 존재하지 않습니다' });
            globalThis.mwindow.webContents.send('worked', 0);
            return;
        }
        if (!globalThis.settings.llmApiKey) {
            globalThis.mwindow.webContents.send('alert', { icon: 'error', message: 'Gemini API 키가 설정되지 않았습니다' });
            globalThis.mwindow.webContents.send('worked', 0);
            return;
        }

        const targetLang = globalThis.settings.llmTargetLang || 'ko';
        const gemini = createGeminiTranslator(globalThis.settings, arg.langu || 'ja', targetLang);
        const fileList = fs.readdirSync(edir).filter(f => f.endsWith('.txt'));

        if (fileList.length === 0) {
            globalThis.mwindow.webContents.send('alert', { icon: 'error', message: 'Extract 폴더에 번역할 .txt 파일이 없습니다' });
            globalThis.mwindow.webContents.send('worked', 0);
            return;
        }

        // Auto-backup
        globalThis.mwindow.webContents.send('loadingTag', '백업 생성 중...');
        const backupDir = createBackup(edir);

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

        const compareFiles: TranslationValidation[] = [];
        let totalErrors = 0;
        let totalBlocks = 0;
        let workedFiles = 0;

        for (const fileName of fileList) {
            const filePath = path.join(edir, fileName);
            const originalContent = fs.readFileSync(filePath, 'utf-8');

            // Resume: skip already completed files
            if (isResuming && completedFiles.has(fileName)) {
                workedFiles++;
                const pct = (workedFiles / fileList.length) * 100;
                globalThis.mwindow.webContents.send('loading', pct);
                globalThis.mwindow.webContents.send('loadingTag', `${fileName} (이전 번역 건너뜀)`);
                continue;
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
                globalThis.mwindow.webContents.send('loading', pct);
                globalThis.mwindow.webContents.send('loadingTag', `${fileName} (캐시 사용)`);
                continue;
            }

            globalThis.mwindow.webContents.send('loadingTag', `[${workedFiles + 1}/${fileList.length}] ${fileName}`);

            const { translatedContent, validation, logEntry } = await gemini.translateFileContent(
                originalContent,
                (current, total, detail) => {
                    const fileProgress = (workedFiles / fileList.length) * 100;
                    const blockProgress = (current / total) * (100 / fileList.length);
                    globalThis.mwindow.webContents.send('loading', fileProgress + blockProgress);
                    globalThis.mwindow.webContents.send('loadingTag', `[${workedFiles + 1}/${fileList.length}] ${fileName} — ${detail} (${current}/${total} 블록)`);
                }
            );

            fs.writeFileSync(filePath, translatedContent, 'utf-8');

            // Update cache
            cache[cacheKey] = { translatedContent, model, targetLang };
            saveCache(edir, cache);

            // Update progress
            completedFiles.add(fileName);
            saveProgress(edir, { completedFiles: [...completedFiles], timestamp: new Date().toISOString() });

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

            compareFiles.push({ fileIndex: workedFiles, fileName, blocks: validation, hasError });
            workedFiles++;
        }

        // Finalize
        clearProgress(edir);
        translationLog.endTime = new Date().toISOString();
        translationLog.totalDurationMs = Date.now() - startTime;
        const logFile = writeTranslationLog(edir, translationLog);

        globalThis.mwindow.webContents.send('loading', 0);
        globalThis.mwindow.webContents.send('loadingTag', '');

        const durationSec = Math.round(translationLog.totalDurationMs / 1000);
        const resumeNote = isResuming ? `\n(이전 진행 상태에서 재개됨)` : '';
        const cacheNote = translationLog.entries.filter(e => e.cached).length;
        const cacheMsg = cacheNote > 0 ? `\n캐시 사용: ${cacheNote}개 파일` : '';
        globalThis.mwindow.webContents.send('alert',
            `번역 완료! (${durationSec}초 소요)\n백업: ${backupDir}\n로그: ${path.basename(logFile)}${resumeNote}${cacheMsg}`
        );

        if (compareFiles.length > 0) {
            const compareData: CompareData = { files: compareFiles, totalErrors, totalBlocks };
            const compareWindow = new BrowserWindow({
                width: 1000, height: 700, resizable: true, show: false, autoHideMenuBar: true,
                webPreferences: { nodeIntegration: true, contextIsolation: false },
                icon: path.join(globalThis.oPath, 'res/icon.png'),
            });
            compareWindow.setMenu(null);
            compareWindow.loadFile('src/html/llm-compare/index.html');
            compareWindow.webContents.on('did-finish-load', () => {
                compareWindow.show();
                compareWindow.webContents.send('compareData', compareData);
            });
        }
    } catch (err) {
        globalThis.mwindow.webContents.send('alert', {
            icon: 'error',
            message: JSON.stringify(err, Object.getOwnPropertyNames(err))
        });
    }
    globalThis.mwindow.webContents.send('worked', 0);
}