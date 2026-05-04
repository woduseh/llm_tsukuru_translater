import { BrowserWindow, ipcMain } from 'electron';
import type { AppContext } from '../appContext';
import { TerminalService } from '../agent/terminalService';
import type {
  TerminalInputRequest,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalSessionCreateRequest,
  TerminalSnapshotRequest,
} from '../types/agentWorkspace';

export function registerTerminalHandlers(ctx: AppContext, terminalService: TerminalService): void {
  ctx.terminalService = terminalService;

  terminalService.onEvent((event) => {
    sendToWindows('terminalEvent', event);
  });
  terminalService.onSessions((result) => {
    sendToWindows('terminalSessions', result);
  });

  ipcMain.handle('terminalCreate', (_event, request: TerminalSessionCreateRequest) => {
    return terminalService.create(request);
  });
  ipcMain.handle('terminalInput', (_event, request: TerminalInputRequest) => {
    return terminalService.input(request);
  });
  ipcMain.handle('terminalResize', (_event, request: TerminalResizeRequest) => {
    return terminalService.resize(request);
  });
  ipcMain.handle('terminalKill', (_event, request: TerminalKillRequest) => {
    return terminalService.kill(request);
  });
  ipcMain.handle('terminalList', () => {
    return terminalService.list();
  });
  ipcMain.handle('terminalSnapshot', (_event, request: TerminalSnapshotRequest) => {
    return terminalService.snapshot(request);
  });
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
