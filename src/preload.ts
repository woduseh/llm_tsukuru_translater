const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

let allowedBasePaths: string[] = [];

ipcRenderer.on('set-allowed-paths', (_event: unknown, paths: string[]) => {
  const resolved = paths.map((p: string) => path.resolve(p));
  allowedBasePaths = [...new Set([...allowedBasePaths, ...resolved])];
});

function isPathAllowed(filePath: string): boolean {
  if (allowedBasePaths.length === 0) return false;
  const resolved = path.resolve(filePath);
  return allowedBasePaths.some((base: string) => resolved === base || resolved.startsWith(base + path.sep));
}

const SEND_CHANNELS = [
  'close', 'minimize', 'select_folder', 'setheight', 'extract', 'apply',
  'changeURL', 'settings', 'applysettings', 'closesettings',
  'openLLMSettings', 'llmSettingsApply', 'llmSettingsClose', 'abortLLM',
  'openLLMCompare', 'llmCompareClose', 'openJsonVerify',
  'retranslateFile', 'retranslateBlocks', 'verifyLlmRepair',
  'openFolder', 'projectConvert', 'log', 'license', 'app_version',
  'getextention', 'selFont', 'changeFontSize', 'updateVersion',
  'wolf_ext', 'wolf_apply', 'gamePatcher',
  'compareReady', 'verifyReady',
  'llmSettingsReady', 'settingsReady', 'mainReady',
];

const RECEIVE_CHANNELS = [
  'set_path', 'getGlobalSettings', 'loadingTag', 'loading', 'worked',
  'check_force', 'alert', 'alert_free', 'alert2',
  'llmTranslating', 'alertExten', 'settings', 'llmSettings',
  'initCompare', 'retranslateProgress', 'retranslateFileDone', 'retranslateBlocksDone',
  'initVerify', 'verifySettings', 'verifyLlmRepairProgress', 'verifyLlmRepairDone',
  'set-allowed-paths',
];

contextBridge.exposeInMainWorld('api', {
  send: (channel: string, ...args: unknown[]) => {
    if (SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      const subscription = (_event: unknown, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, subscription as (...args: unknown[]) => void);
      return subscription;
    }
  },
  once: (channel: string, callback: (...args: any[]) => void) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.once(channel, (_event: unknown, ...args: unknown[]) => callback(...args));
    }
  },
  removeAllListeners: (channel: string) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  invoke: (channel: string, ...args: unknown[]) => {
    if (SEND_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
  }
});

contextBridge.exposeInMainWorld('nodeBuffer', {
  toBase64: (str: string) => Buffer.from(str, 'utf8').toString('base64'),
  fromBase64: (str: string) => Buffer.from(str, 'base64').toString('utf8')
});

contextBridge.exposeInMainWorld('nodeFs', {
  readFileSync: (filePath: string, encoding: string) => {
    if (!isPathAllowed(filePath)) throw new Error('Access denied: path not in allowed directories');
    return require('fs').readFileSync(filePath, encoding);
  },
  readdirSync: (dirPath: string) => {
    if (!isPathAllowed(dirPath)) throw new Error('Access denied: path not in allowed directories');
    return require('fs').readdirSync(dirPath);
  },
  existsSync: (filePath: string) => {
    if (!isPathAllowed(filePath)) throw new Error('Access denied: path not in allowed directories');
    return require('fs').existsSync(filePath);
  },
  writeFileSync: (filePath: string, data: string, encoding: string) => {
    if (!isPathAllowed(filePath)) throw new Error('Access denied: path not in allowed directories');
    return require('fs').writeFileSync(filePath, data, encoding);
  }
});

contextBridge.exposeInMainWorld('nodePath', {
  join: (...args: string[]) => require('path').join(...args),
  parse: (p: string) => require('path').parse(p),
  basename: (p: string) => require('path').basename(p)
});

contextBridge.exposeInMainWorld('verify', {
  verifyJsonIntegrity: (orig: unknown, trans: unknown) => {
    const { verifyJsonIntegrity } = require('./js/rpgmv/verify.js');
    return verifyJsonIntegrity(orig, trans);
  },
  repairJson: (orig: unknown, trans: unknown) => {
    const { repairJson } = require('./js/rpgmv/verify.js');
    return repairJson(orig, trans);
  },
  getAtPath: (obj: unknown, jsonPath: string) => {
    const { getAtPath } = require('./js/rpgmv/verify.js');
    return getAtPath(obj, jsonPath);
  },
  setAtPath: (obj: unknown, jsonPath: string, value: unknown) => {
    const { setAtPath } = require('./js/rpgmv/verify.js');
    return setAtPath(obj, jsonPath, value);
  }
});
