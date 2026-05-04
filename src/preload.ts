const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
import { isReceiveChannel, isSendChannel } from './types/ipc';

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

contextBridge.exposeInMainWorld('api', {
  send: (channel: string, ...args: unknown[]) => {
    if (isSendChannel(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (channel: string, callback: (...args: any[]) => void) => {
    if (isReceiveChannel(channel)) {
      const subscription = (_event: unknown, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, subscription as (...args: unknown[]) => void);
      return subscription;
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once: (channel: string, callback: (...args: any[]) => void) => {
    if (isReceiveChannel(channel)) {
      ipcRenderer.once(channel, (_event: unknown, ...args: unknown[]) => callback(...args));
    }
  },
  removeAllListeners: (channel: string) => {
    if (isReceiveChannel(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  invoke: (channel: string, ...args: unknown[]) => {
    if (isSendChannel(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
  },
  terminal: {
    create: (request: unknown) => ipcRenderer.invoke('terminalCreate', request),
    input: (request: unknown) => ipcRenderer.invoke('terminalInput', request),
    resize: (request: unknown) => ipcRenderer.invoke('terminalResize', request),
    kill: (request: unknown) => ipcRenderer.invoke('terminalKill', request),
    list: () => ipcRenderer.invoke('terminalList'),
    snapshot: (request: unknown) => ipcRenderer.invoke('terminalSnapshot', request),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('terminalEvent', listener);
      return () => ipcRenderer.removeListener('terminalEvent', listener);
    },
    onSessions: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('terminalSessions', listener);
      return () => ipcRenderer.removeListener('terminalSessions', listener);
    },
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
    const { verifyJsonIntegrity } = require('./ts/rpgmv/verify');
    return verifyJsonIntegrity(orig, trans);
  },
  repairJson: (orig: unknown, trans: unknown) => {
    const { repairJson } = require('./ts/rpgmv/verify');
    return repairJson(orig, trans);
  },
  getAtPath: (obj: unknown, jsonPath: string) => {
    const { getAtPath } = require('./ts/rpgmv/verify');
    return getAtPath(obj, jsonPath);
  },
  setAtPath: (obj: unknown, jsonPath: string, value: unknown) => {
    const { setAtPath } = require('./ts/rpgmv/verify');
    return setAtPath(obj, jsonPath, value);
  }
});
