"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const eztrans = __importStar(require("../js/rpgmv/translator.js"));
const shared_1 = require("./shared");
const toolsHandler_1 = require("./toolsHandler");
const viteHelper_1 = require("./viteHelper");
const logger_1 = __importDefault(require("../logger"));
let llmSettingsWindow = null;
let llmPendingArg = null;
electron_1.ipcMain.on('eztrans', eztrans.trans);
electron_1.ipcMain.on('openLLMSettings', (ev, arg) => {
    llmPendingArg = arg;
    if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
        llmSettingsWindow.focus();
        return;
    }
    llmSettingsWindow = new electron_1.BrowserWindow({
        width: 550,
        height: 420,
        resizable: true,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path_1.default.join(__dirname, '..', 'preload.js')
        },
        icon: path_1.default.join(__dirname, '../../res/icon.png'),
    });
    llmSettingsWindow.setMenu(null);
    (0, viteHelper_1.loadRoute)(llmSettingsWindow, '/llm-settings');
    llmSettingsWindow.webContents.on('did-finish-load', () => {
        llmSettingsWindow.show();
        llmSettingsWindow.webContents.send('llmSettings', globalThis.settings);
    });
    llmSettingsWindow.on('closed', () => {
        llmSettingsWindow = null;
    });
});
electron_1.ipcMain.on('llmSettingsApply', (ev, data) => {
    globalThis.settings = { ...globalThis.settings, llmSortOrder: data.llmSortOrder };
    shared_1.storage.set('settings', JSON.stringify(globalThis.settings));
    if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
        llmSettingsWindow.close();
    }
    if (llmPendingArg) {
        globalThis.llmAbort = false;
        const a = {
            dir: Buffer.from(llmPendingArg.dir, 'utf8').toString('base64'),
            type: 'gemini',
            langu: globalThis.settings.llmSourceLang || 'ja',
            game: llmPendingArg.game,
            resetProgress: data.llmResetProgress || false,
            sortOrder: data.llmSortOrder || 'name-asc',
            translationMode: data.llmTranslationMode || 'untranslated'
        };
        (0, shared_1.getMainWindow)().webContents.send('loading', 1);
        eztrans.trans(null, a);
        llmPendingArg = null;
    }
});
electron_1.ipcMain.on('abortLLM', () => {
    globalThis.llmAbort = true;
});
electron_1.ipcMain.on('llmSettingsClose', () => {
    if (llmSettingsWindow && !llmSettingsWindow.isDestroyed()) {
        llmSettingsWindow.close();
    }
});
electron_1.ipcMain.on('retranslateFile', async (_ev, data) => {
    const wolfEdir = path_1.default.join(data.dir, '_Extract', 'Texts');
    const mvEdir = path_1.default.join(data.dir, 'Extract');
    const edir = (fs_1.default.existsSync(wolfEdir) && fs_1.default.existsSync(wolfEdir + '_backup')) ? wolfEdir : mvEdir;
    globalThis.llmAbort = false;
    try {
        const result = await eztrans.retranslateFile(edir, data.fileName, globalThis.settings.llmSourceLang || 'ja', globalThis.settings.llmTargetLang || 'ko', (msg) => {
            const lcw = (0, toolsHandler_1.getLLMCompareWindow)();
            if (lcw && !lcw.isDestroyed()) {
                lcw.webContents.send('retranslateProgress', msg);
            }
        });
        const lcw = (0, toolsHandler_1.getLLMCompareWindow)();
        if (lcw && !lcw.isDestroyed()) {
            lcw.webContents.send('retranslateFileDone', result);
        }
    }
    catch (err) {
        logger_1.default.error('Retranslate file failed:', err);
        const lcw = (0, toolsHandler_1.getLLMCompareWindow)();
        if (lcw && !lcw.isDestroyed()) {
            lcw.webContents.send('retranslateFileDone', { success: false, error: err.message || String(err) });
        }
    }
});
electron_1.ipcMain.on('retranslateBlocks', async (_ev, data) => {
    const wolfEdir = path_1.default.join(data.dir, '_Extract', 'Texts');
    const mvEdir = path_1.default.join(data.dir, 'Extract');
    const edir = (fs_1.default.existsSync(wolfEdir) && fs_1.default.existsSync(wolfEdir + '_backup')) ? wolfEdir : mvEdir;
    globalThis.llmAbort = false;
    try {
        const result = await eztrans.retranslateBlocks(edir, data.fileName, data.blockIndices, globalThis.settings.llmSourceLang || 'ja', globalThis.settings.llmTargetLang || 'ko', (msg) => {
            const lcw = (0, toolsHandler_1.getLLMCompareWindow)();
            if (lcw && !lcw.isDestroyed()) {
                lcw.webContents.send('retranslateProgress', msg);
            }
        });
        const lcw = (0, toolsHandler_1.getLLMCompareWindow)();
        if (lcw && !lcw.isDestroyed()) {
            lcw.webContents.send('retranslateBlocksDone', result);
        }
    }
    catch (err) {
        logger_1.default.error('Retranslate blocks failed:', err);
        const lcw = (0, toolsHandler_1.getLLMCompareWindow)();
        if (lcw && !lcw.isDestroyed()) {
            lcw.webContents.send('retranslateBlocksDone', { success: false, error: err.message || String(err) });
        }
    }
});
