const { contextBridge, ipcRenderer }: typeof import('electron') = require('electron');
const path = require('path');
import { isInvokeChannel, isReceiveChannel, isSendChannel } from './types/ipc';
import type { ElectronApi, IpcCallback, ReceiveArgs, ReceiveChannel } from './types/ipc';
import { isProtectedAgentBridgePath } from './agent/agentBridgeContracts';

let allowedBasePaths: string[] = [];
let pathGrantRevision = 0;

ipcRenderer.on('set-allowed-paths', (_event: unknown, paths: string[]) => {
  const resolved = paths.map((p: string) => path.resolve(p));
  allowedBasePaths = [...new Set([...allowedBasePaths, ...resolved])];
});

ipcRenderer.on('replace-allowed-paths', (_event: unknown, paths: string[]) => {
  pathGrantRevision++;
  allowedBasePaths = [...new Set(paths.map((p: string) => path.resolve(p)))];
});

function isPathAllowed(filePath: string): boolean {
  if (allowedBasePaths.length === 0) return false;
  const resolved = path.resolve(filePath);
  if (isProtectedAgentBridgePath(resolved)) return false;
  return allowedBasePaths.some((base: string) => resolved === base || resolved.startsWith(base + path.sep));
}

const api: ElectronApi = {
  send: (channel, ...args) => {
    if (isSendChannel(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: <C extends ReceiveChannel>(channel: C, callback: IpcCallback<C>) => {
    if (isReceiveChannel(channel)) {
      const subscription = (_event: unknown, ...args: unknown[]) => callback(...args as ReceiveArgs[C]);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  },
  once: <C extends ReceiveChannel>(channel: C, callback: IpcCallback<C>) => {
    if (isReceiveChannel(channel)) {
      ipcRenderer.once(channel, (_event: unknown, ...args: unknown[]) => callback(...args as ReceiveArgs[C]));
    }
  },
  removeAllListeners: (channel) => {
    if (isReceiveChannel(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  invoke: async (channel, ...args) => {
    if (isInvokeChannel(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error('Access denied: IPC invoke channel not allowed');
  },
  terminal: {
    create: (request) => ipcRenderer.invoke('terminalCreate', request),
    input: (request) => ipcRenderer.invoke('terminalInput', request),
    resize: (request) => ipcRenderer.invoke('terminalResize', request),
    kill: (request) => ipcRenderer.invoke('terminalKill', request),
    list: () => ipcRenderer.invoke('terminalList'),
    snapshot: (request) => ipcRenderer.invoke('terminalSnapshot', request),
    onEvent: (callback) => {
      const listener = (_event: unknown, payload: ReceiveArgs['terminalEvent'][0]) => callback(payload);
      ipcRenderer.on('terminalEvent', listener);
      return () => ipcRenderer.removeListener('terminalEvent', listener);
    },
    onSessions: (callback) => {
      const listener = (_event: unknown, payload: ReceiveArgs['terminalSessions'][0]) => callback(payload);
      ipcRenderer.on('terminalSessions', listener);
      return () => ipcRenderer.removeListener('terminalSessions', listener);
    },
  },
  approvals: {
    submit: (request) => ipcRenderer.invoke('mutationApprovalSubmit', request),
    list: (request) => ipcRenderer.invoke('mutationApprovalList', request),
    get: (request) => ipcRenderer.invoke('mutationApprovalGet', request),
    approve: (request) => ipcRenderer.invoke('mutationApprovalApprove', request),
    deny: (request) => ipcRenderer.invoke('mutationApprovalDeny', request),
    onChanged: (callback) => {
      const listener = (_event: unknown, payload: ReceiveArgs['approvalQueueChanged'][0]) => callback(payload);
      ipcRenderer.on('approvalQueueChanged', listener);
      return () => ipcRenderer.removeListener('approvalQueueChanged', listener);
    },
  }
};

contextBridge.exposeInMainWorld('api', api);

contextBridge.exposeInMainWorld('nodeBuffer', {
  toBase64: (str: string) => Buffer.from(str, 'utf8').toString('base64'),
  fromBase64: (str: string) => Buffer.from(str, 'base64').toString('utf8')
});

async function readWithPathGrant<T>(filePath: string, read: () => Promise<T>): Promise<T> {
  if (!isPathAllowed(filePath)) throw new Error('Access denied: path not in allowed directories');
  const revision = pathGrantRevision;
  const value = await read();
  if (revision !== pathGrantRevision || !isPathAllowed(filePath)) {
    throw new Error('Access denied: project access changed during read');
  }
  return value;
}

contextBridge.exposeInMainWorld('nodeFs', {
  readTextFile: (filePath: string) => readWithPathGrant<string>(filePath, () => require('fs').promises.readFile(filePath, 'utf8')),
  readDirectory: (dirPath: string) => readWithPathGrant<string[]>(dirPath, () => require('fs').promises.readdir(dirPath)),
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
