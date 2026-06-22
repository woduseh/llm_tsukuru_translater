import { ipcMain } from 'electron';
import type { AppContext } from '../appContext';
import { detectAgentExecutables } from '../agent/agentExecutableDetection';
import { buildAgentWorkspaceStatus } from '../agent/agentWorkspaceStatus';
import { getLlmReadinessError } from '../ts/libs/translatorFactory';

/**
 * Handlers for the agent workspace surfaces that need main-process capabilities
 * (PATH probing, live readiness, etc.). All handlers are read-only and never
 * spawn a process or mutate project files.
 */
export function registerAgentHandlers(ctx: AppContext): void {
  ipcMain.handle('detectAgentExecutables', (_event, items: unknown) => {
    return detectAgentExecutables(items);
  });

  ipcMain.handle('getAgentWorkspaceStatus', () => {
    const capability = ctx.terminalService?.getCapability();
    return buildAgentWorkspaceStatus({
      projectRoots: ctx.terminalProjectRoots,
      currentProjectRoot: ctx.currentTerminalProjectRoot,
      providerReadyError: getLlmReadinessError(ctx.settings),
      terminalCapabilityStatus: capability?.status,
      terminalReason: capability?.reason,
    });
  });
}
