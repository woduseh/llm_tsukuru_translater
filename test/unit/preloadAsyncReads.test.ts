import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import * as channels from '../../src/types/ipc';
import * as bridge from '../../src/agent/agentBridgeContracts';

function preload() {
  const exposed: Record<string, any> = {};
  const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn(), send: vi.fn() });
  const readFile = vi.fn(async () => 'text');
  const readdir = vi.fn(async () => ['Map001.txt']);
  const code = ts.transpileModule(fs.readFileSync(path.resolve('src/preload.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(code, { exports: {}, Buffer, require: (name: string) => {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (key: string, value: unknown) => { exposed[key] = value; } } };
    if (name === 'path') return path;
    if (name === './types/ipc') return channels;
    if (name === './agent/agentBridgeContracts') return bridge;
    if (name === 'fs') return { promises: { readFile, readdir } };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { api: exposed.nodeFs as { readTextFile(p: string): Promise<string>; readDirectory(p: string): Promise<string[]> }, ipc, readFile, readdir };
}

it('uses async filesystem reads only within currently granted project directories', async () => {
  const { api, ipc, readFile, readdir } = preload();
  const root = path.resolve('artifacts/unit/async-project');
  const file = path.join(root, 'Map001.txt');
  await expect(api.readTextFile(file)).rejects.toThrow('Access denied');
  expect(readFile).not.toHaveBeenCalled();
  ipc.emit('replace-allowed-paths', {}, [root]);
  await expect(api.readTextFile(file)).resolves.toBe('text');
  await expect(api.readDirectory(root)).resolves.toEqual(['Map001.txt']);
  expect(readFile).toHaveBeenCalledWith(file, 'utf8');
  expect(readdir).toHaveBeenCalledWith(root);
  await expect(api.readTextFile(path.join(root, '..', 'outside.txt'))).rejects.toThrow('Access denied');
});

it('does not release a pending read after project grants are replaced, even when later regranted', async () => {
  const { api, ipc, readFile } = preload();
  const root = path.resolve('artifacts/unit/async-project');
  ipc.emit('replace-allowed-paths', {}, [root]);
  let finish!: (text: string) => void;
  readFile.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = api.readTextFile(path.join(root, 'Map001.txt'));
  const rejected = expect(pending).rejects.toThrow('project access changed');
  ipc.emit('replace-allowed-paths', {}, []);
  ipc.emit('replace-allowed-paths', {}, [root]);
  finish('old project content');
  await rejected;
});
