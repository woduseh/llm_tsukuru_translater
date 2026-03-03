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
exports.storage = void 0;
exports.defaultHeight = 550;
exports.getMainId = getMainId;
exports.setMainId = setMainId;
exports.getMainWindow = getMainWindow;
exports.sendAlert = sendAlert;
exports.sendError = sendError;
exports.worked = worked;
exports.getSettings = getSettings;
exports.loadSettings = loadSettings;
exports.setOPath = setOPath;
const electron_1 = require("electron");
const electron_store_1 = __importDefault(require("electron-store"));
const projectTools_1 = __importDefault(require("../js/libs/projectTools"));
const dataBaseO = __importStar(require("../js/rpgmv/datas.js"));
exports.storage = new electron_store_1.default({ encryptionKey: 'tsukuru-extractor-store-key' });
let mainid = 0;
function getMainId() {
    return mainid;
}
function setMainId(id) {
    mainid = id;
}
function getMainWindow() {
    const ID = mainid * 1;
    return electron_1.BrowserWindow.fromId(ID);
}
function sendAlert(txt) {
    getMainWindow().webContents.send('alert', txt);
}
function sendError(txt) {
    getMainWindow().webContents.send('alert', { icon: 'error', message: txt });
}
function worked() {
    getMainWindow().webContents.send('worked', 0);
    getMainWindow().webContents.send('loading', 0);
}
function getSettings() {
    return globalThis.settings;
}
async function loadSettings() {
    let givensettings = {};
    if (exports.storage.has('settings')) {
        givensettings = JSON.parse(exports.storage.get('settings'));
    }
    globalThis.settings = dataBaseO.settings;
    globalThis.settings = { ...globalThis.settings, ...givensettings };
    globalThis.settings.version = electron_1.app.getVersion();
    exports.storage.set('settings', JSON.stringify(globalThis.settings));
}
function setOPath() {
    if (projectTools_1.default.packed) {
        globalThis.oPath = process.resourcesPath;
    }
    else {
        globalThis.oPath = __dirname.replace(/[/\\]src[/\\]ipc$/, '');
    }
}
