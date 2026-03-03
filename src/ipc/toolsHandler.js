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
exports.getLLMCompareWindow = getLLMCompareWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const open_1 = __importDefault(require("open"));
const prjc = __importStar(require("../js/rpgmv/projectConvert"));
const viteHelper_1 = require("./viteHelper");
let llmCompareWindow = null;
let jsonVerifyWindow = null;
function getLLMCompareWindow() {
    return llmCompareWindow;
}
electron_1.ipcMain.on('openLLMCompare', (ev, dir) => {
    if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
        llmCompareWindow.webContents.send('initCompare', dir);
        llmCompareWindow.focus();
        return;
    }
    llmCompareWindow = new electron_1.BrowserWindow({
        width: 1100,
        height: 750,
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
    llmCompareWindow.setMenu(null);
    (0, viteHelper_1.loadRoute)(llmCompareWindow, '/llm-compare');
    llmCompareWindow.webContents.on('did-finish-load', () => {
        llmCompareWindow.show();
        llmCompareWindow.webContents.send('initCompare', dir);
    });
    llmCompareWindow.on('closed', () => {
        llmCompareWindow = null;
    });
});
electron_1.ipcMain.on('llmCompareClose', () => {
    if (llmCompareWindow && !llmCompareWindow.isDestroyed()) {
        llmCompareWindow.close();
    }
});
electron_1.ipcMain.on('openJsonVerify', (ev, dir) => {
    if (jsonVerifyWindow && !jsonVerifyWindow.isDestroyed()) {
        jsonVerifyWindow.webContents.send('initVerify', dir);
        jsonVerifyWindow.focus();
        return;
    }
    jsonVerifyWindow = new electron_1.BrowserWindow({
        width: 900,
        height: 700,
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
    jsonVerifyWindow.setMenu(null);
    (0, viteHelper_1.loadRoute)(jsonVerifyWindow, '/json-verify');
    jsonVerifyWindow.webContents.on('did-finish-load', () => {
        jsonVerifyWindow.show();
        jsonVerifyWindow.webContents.send('verifySettings', globalThis.settings);
        jsonVerifyWindow.webContents.send('initVerify', dir);
    });
    jsonVerifyWindow.on('closed', () => {
        jsonVerifyWindow = null;
    });
});
electron_1.ipcMain.on('openFolder', (ev, arg) => {
    (0, open_1.default)(arg);
});
electron_1.ipcMain.on('log', async (ev, arg) => console.log(arg));
electron_1.ipcMain.on('projectConvert', async (ev, arg) => prjc.ConvertProject(arg));
