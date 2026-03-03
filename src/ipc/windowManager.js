"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWindow = createWindow;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const projectTools_1 = __importDefault(require("../js/libs/projectTools"));
const styles_1 = __importDefault(require("../js/rpgmv/styles"));
const shared_1 = require("./shared");
const viteHelper_1 = require("./viteHelper");
function createWindow() {
    (0, shared_1.loadSettings)();
    (0, shared_1.setOPath)();
    const mainWindow = new electron_1.BrowserWindow({
        width: 800,
        height: shared_1.defaultHeight,
        show: false,
        resizable: false,
        autoHideMenuBar: true,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, '..', 'preload.js')
        },
        icon: path_1.default.join(__dirname, '../../res/icon.png')
    });
    mainWindow.setMenu(null);
    (0, viteHelper_1.loadRoute)(mainWindow, '/');
    mainWindow.webContents.on('did-finish-load', function () {
        const initialPaths = [
            electron_1.app.getPath('userData'),
            electron_1.app.getAppPath(),
            path_1.default.join(electron_1.app.getAppPath(), 'res'),
        ];
        mainWindow.webContents.send('set-allowed-paths', initialPaths);
        mainWindow.show();
        (0, shared_1.getMainWindow)().webContents.send('is_version', electron_1.app.getVersion());
        globalThis.settings.themeData = styles_1.default[globalThis.settings.theme];
        const { llmApiKey, ...safeSettings } = globalThis.settings;
        (0, shared_1.getMainWindow)().webContents.send('getGlobalSettings', safeSettings);
        if (!projectTools_1.default.packed) {
            electron_1.globalShortcut.register('Control+Shift+I', () => {
                mainWindow.webContents.openDevTools();
                return false;
            });
        }
    });
    (0, shared_1.setMainId)(mainWindow.id);
    globalThis.mwindow = mainWindow;
    mainWindow.on('close', () => {
        electron_1.app.quit();
    });
    projectTools_1.default.init();
}
electron_1.ipcMain.on('license', () => {
    const licenseWindow = new electron_1.BrowserWindow({
        width: 800,
        height: 400,
        resizable: true,
        autoHideMenuBar: true,
        icon: path_1.default.join(__dirname, '../../res/icon.png')
    });
    licenseWindow.setMenu(null);
    licenseWindow.loadFile('src/html/license.html');
    licenseWindow.show();
});
electron_1.ipcMain.on('changeURL', (ev, arg) => {
    // Legacy: map old HTML paths to Vue routes
    const routeMap = {
        './src/html/main/index.html': '/mvmz',
        './src/html/wolf/index.html': '/wolf',
    };
    const route = routeMap[arg] || arg;
    (0, viteHelper_1.loadRoute)(globalThis.mwindow, route);
});
electron_1.ipcMain.on('minimize', () => {
    (0, shared_1.getMainWindow)().minimize();
});
electron_1.ipcMain.on('close', () => {
    (0, shared_1.getMainWindow)().close();
});
electron_1.ipcMain.on('setheight', (ev, arg) => {
    globalThis.mwindow.setResizable(true);
    globalThis.mwindow.setSize(800, arg, false);
    globalThis.mwindow.setResizable(false);
});
electron_1.ipcMain.on('app_version', (event) => {
    event.sender.send('app_version', { version: electron_1.app.getVersion() });
});
electron_1.ipcMain.on('select_folder', async (ev, typeo) => {
    let Path = await electron_1.dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (!Path.canceled) {
        const qs = Path.filePaths[0];
        let qv;
        if (qs.includes('\\')) {
            qv = qs.split('\\')[qs.split('\\').length - 1];
        }
        else {
            qv = qs.split('/')[qs.split('/').length - 1];
        }
        let dir = qs;
        if (qv === 'data') {
            (0, shared_1.getMainWindow)().webContents.send('set_path', { type: typeo, dir: dir });
            (0, shared_1.getMainWindow)().webContents.send('set-allowed-paths', [dir]);
        }
        else {
            if (fs_1.default.existsSync(path_1.default.join(qs, 'www', 'data'))) {
                (0, shared_1.getMainWindow)().webContents.send('set_path', { type: typeo, dir: path_1.default.join(qs, 'www', 'data') });
                (0, shared_1.getMainWindow)().webContents.send('set-allowed-paths', [path_1.default.join(qs, 'www', 'data')]);
            }
            else if (fs_1.default.existsSync(path_1.default.join(qs, 'data'))) {
                (0, shared_1.getMainWindow)().webContents.send('set_path', { type: typeo, dir: path_1.default.join(qs, 'data') });
                (0, shared_1.getMainWindow)().webContents.send('set-allowed-paths', [path_1.default.join(qs, 'data')]);
            }
            else if (fs_1.default.existsSync(path_1.default.join(qs, 'Data.wolf'))) {
                (0, shared_1.getMainWindow)().webContents.send('set_path', { type: typeo, dir: path_1.default.join(qs) });
                (0, shared_1.getMainWindow)().webContents.send('set-allowed-paths', [path_1.default.join(qs)]);
            }
            else {
                (0, shared_1.getMainWindow)().webContents.send('alert', { icon: 'error', message: '폴더가 올바르지 않습니다' });
            }
        }
    }
});
