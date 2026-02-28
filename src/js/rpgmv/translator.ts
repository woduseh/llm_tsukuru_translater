import path from 'path';
import fs from 'fs';
import { BrowserWindow } from 'electron';
import { createGeminiTranslator, CompareData, TranslationValidation } from '../libs/geminiTranslator';

export const trans = async (ev, arg) => {
    // LLM (Gemini) translation
    try {
        const dir = Buffer.from(arg.dir, "base64").toString('utf8');
        const edir = arg.game === 'wolf' ? path.join(dir, '_Extract', 'Texts') : path.join(dir, 'Extract')
        if (!fs.existsSync(edir)) {
            globalThis.mwindow.webContents.send('alert', {
                icon: 'error',
                message: 'Extract 폴더가 존재하지 않습니다'
            });
            globalThis.mwindow.webContents.send('worked', 0);
            return
        }
        if (!globalThis.settings.llmApiKey) {
            globalThis.mwindow.webContents.send('alert', {
                icon: 'error',
                message: 'Gemini API 키가 설정되지 않았습니다'
            });
            globalThis.mwindow.webContents.send('worked', 0);
            return
        }
        const gemini = createGeminiTranslator(globalThis.settings, arg.langu || 'ja', 'ko');
        const fileList = fs.readdirSync(edir).filter(f => f.endsWith('.txt'));
        const compareFiles: TranslationValidation[] = [];
        let totalErrors = 0;
        let totalBlocks = 0;
        let workedFiles = 0;

        if (fileList.length === 0) {
            globalThis.mwindow.webContents.send('alert', {
                icon: 'error',
                message: 'Extract 폴더에 번역할 .txt 파일이 없습니다'
            });
            globalThis.mwindow.webContents.send('worked', 0);
            return
        }

        for (const fileName of fileList) {
            const filePath = path.join(edir, fileName);
            const originalContent = fs.readFileSync(filePath, 'utf-8');

            globalThis.mwindow.webContents.send('loadingTag', `${fileName} `);
            const { translatedContent, validation } = await gemini.translateFileContent(
                originalContent,
                (current, total) => {
                    const fileProgress = (workedFiles / fileList.length) * 100;
                    const blockProgress = (current / total) * (100 / fileList.length);
                    globalThis.mwindow.webContents.send('loading', fileProgress + blockProgress);
                }
            );

            fs.writeFileSync(filePath, translatedContent, 'utf-8');

            const hasError = validation.some(b => !b.lineCountMatch || !b.separatorMatch);
            if (hasError) totalErrors += validation.filter(b => !b.lineCountMatch || !b.separatorMatch).length;
            totalBlocks += validation.length;

            compareFiles.push({
                fileIndex: workedFiles,
                fileName,
                blocks: validation,
                hasError
            });
            workedFiles++;
        }

        globalThis.mwindow.webContents.send('loading', 0);
        globalThis.mwindow.webContents.send('loadingTag', '');
        globalThis.mwindow.webContents.send('alert', '번역이 완료되었습니다');

        const compareData: CompareData = { files: compareFiles, totalErrors, totalBlocks };
        const compareWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            resizable: true,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
            icon: path.join(globalThis.oPath, 'res/icon.png'),
        });
        compareWindow.setMenu(null);
        compareWindow.loadFile('src/html/llm-compare/index.html');
        compareWindow.webContents.on('did-finish-load', () => {
            compareWindow.show();
            compareWindow.webContents.send('compareData', compareData);
        });
    } catch (err) {
        globalThis.mwindow.webContents.send('alert', {
            icon: 'error',
            message: JSON.stringify(err, Object.getOwnPropertyNames(err))
        });
    }
    globalThis.mwindow.webContents.send('worked', 0);
}