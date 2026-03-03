"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
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
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const edTool = __importStar(require("../js/rpgmv/edtool.js"));
const styles_1 = __importDefault(require("../js/rpgmv/styles"));
const shared_1 = require("./shared");
electron_1.ipcMain.on('settings', () => {
    globalThis.settingsWindow = new electron_1.BrowserWindow({
        width: 800,
        height: 900,
        resizable: true,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path_1.default.join(__dirname, '../../res/icon.png'),
    });
    globalThis.settingsWindow.setMenu(null);
    globalThis.settingsWindow.loadFile('src/html/config/settings.html');
    globalThis.settingsWindow.webContents.on('did-finish-load', function () {
        globalThis.settingsWindow.show();
        globalThis.settingsWindow.webContents.send('settings', (0, shared_1.getSettings)());
    });
    globalThis.settingsWindow.on('close', function () {
        (0, shared_1.worked)();
    });
    globalThis.settingsWindow.show();
});
electron_1.ipcMain.on('applysettings', async (ev, arg) => {
    globalThis.settings = { ...globalThis.settings, ...arg };
    shared_1.storage.set('settings', JSON.stringify(globalThis.settings));
    globalThis.settingsWindow.close();
    globalThis.settings.themeData = styles_1.default[globalThis.settings.theme];
    const { llmApiKey, ...safeSettings } = globalThis.settings;
    (0, shared_1.getMainWindow)().webContents.send('getGlobalSettings', safeSettings);
    (0, shared_1.worked)();
});
electron_1.ipcMain.on('closesettings', async (ev, arg) => {
    globalThis.settingsWindow.close();
    (0, shared_1.worked)();
});
electron_1.ipcMain.on('changeLang', (ev, arg) => {
    globalThis.settings.language = arg;
    shared_1.storage.set('settings', JSON.stringify(globalThis.settings));
    globalThis.mwindow.reload();
});
electron_1.ipcMain.on('gamePatcher', (ev, dir) => {
    if (!edTool.exists(dir)) {
        (0, shared_1.sendError)('추출된 파일이 없습니다');
        (0, shared_1.worked)();
        return;
    }
    globalThis.settingsWindow = new electron_1.BrowserWindow({
        width: 800,
        height: 400,
        resizable: false,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path_1.default.join(__dirname, '../../res/icon.png'),
    });
    globalThis.settingsWindow.setMenu(null);
    globalThis.settingsWindow.loadFile('src/html/patcher/index.html');
    globalThis.settingsWindow.webContents.on('did-finish-load', function () {
        globalThis.settingsWindow.show();
        globalThis.settingsWindow.webContents.send('settings', (0, shared_1.getSettings)());
    });
    globalThis.settingsWindow.on('close', function () {
        (0, shared_1.worked)();
    });
    globalThis.settingsWindow.show();
});
