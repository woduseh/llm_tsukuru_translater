"use strict";
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
let allowedBasePaths = [];
ipcRenderer.on('set-allowed-paths', (_event, paths) => {
    const resolved = paths.map((p) => path.resolve(p));
    allowedBasePaths = [...new Set([...allowedBasePaths, ...resolved])];
});
function isPathAllowed(filePath) {
    if (allowedBasePaths.length === 0)
        return false;
    const resolved = path.resolve(filePath);
    return allowedBasePaths.some((base) => resolved === base || resolved.startsWith(base + path.sep));
}
const SEND_CHANNELS = [
    'close', 'minimize', 'select_folder', 'setheight', 'extract', 'apply',
    'changeURL', 'settings', 'applysettings', 'closesettings', 'changeLang',
    'eztrans', 'openLLMSettings', 'llmSettingsApply', 'llmSettingsClose', 'abortLLM',
    'openLLMCompare', 'llmCompareClose', 'openJsonVerify',
    'retranslateFile', 'retranslateBlocks',
    'openFolder', 'projectConvert', 'log', 'license', 'app_version',
    'getextention', 'selFont', 'changeFontSize', 'updateVersion',
    'wolf_ext', 'wolf_apply', 'gamePatcher',
];
const RECEIVE_CHANNELS = [
    'set_path', 'getGlobalSettings', 'loadingTag', 'loading', 'worked',
    'check_force', 'alert', 'alert_free', 'alert2', 'is_version',
    'llmTranslating', 'alertExten', 'settings', 'llmSettings',
    'initCompare', 'retranslateProgress', 'retranslateFileDone', 'retranslateBlocksDone',
    'initVerify', 'verifySettings',
    'set-allowed-paths',
];
contextBridge.exposeInMainWorld('api', {
    send: (channel, ...args) => {
        if (SEND_CHANNELS.includes(channel)) {
            ipcRenderer.send(channel, ...args);
        }
    },
    on: (channel, callback) => {
        if (RECEIVE_CHANNELS.includes(channel)) {
            const subscription = (_event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);
            return subscription;
        }
    },
    once: (channel, callback) => {
        if (RECEIVE_CHANNELS.includes(channel)) {
            ipcRenderer.once(channel, (_event, ...args) => callback(...args));
        }
    },
    removeAllListeners: (channel) => {
        if (RECEIVE_CHANNELS.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        }
    },
    invoke: (channel, ...args) => {
        if (SEND_CHANNELS.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
    }
});
contextBridge.exposeInMainWorld('nodeBuffer', {
    toBase64: (str) => Buffer.from(str, 'utf8').toString('base64'),
    fromBase64: (str) => Buffer.from(str, 'base64').toString('utf8')
});
contextBridge.exposeInMainWorld('nodeFs', {
    readFileSync: (filePath, encoding) => {
        if (!isPathAllowed(filePath))
            throw new Error('Access denied: path not in allowed directories');
        return require('fs').readFileSync(filePath, encoding);
    },
    readdirSync: (dirPath) => {
        if (!isPathAllowed(dirPath))
            throw new Error('Access denied: path not in allowed directories');
        return require('fs').readdirSync(dirPath);
    },
    existsSync: (filePath) => {
        if (!isPathAllowed(filePath))
            throw new Error('Access denied: path not in allowed directories');
        return require('fs').existsSync(filePath);
    },
    writeFileSync: (filePath, data, encoding) => {
        if (!isPathAllowed(filePath))
            throw new Error('Access denied: path not in allowed directories');
        return require('fs').writeFileSync(filePath, data, encoding);
    }
});
contextBridge.exposeInMainWorld('nodePath', {
    join: (...args) => require('path').join(...args),
    parse: (p) => require('path').parse(p),
    basename: (p) => require('path').basename(p)
});
contextBridge.exposeInMainWorld('verify', {
    verifyJsonIntegrity: (orig, trans) => {
        const { verifyJsonIntegrity } = require('./js/rpgmv/verify.js');
        return verifyJsonIntegrity(orig, trans);
    },
    repairJson: (orig, trans) => {
        const { repairJson } = require('./js/rpgmv/verify.js');
        return repairJson(orig, trans);
    }
});
