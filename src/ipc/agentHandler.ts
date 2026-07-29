import { ipcMain } from 'electron';
import type { AppContext } from '../appContext';
import { detectAgentExecutables } from '../agent/agentExecutableDetection';
import { buildAgentWorkspaceStatus } from '../agent/agentWorkspaceStatus';
import { getLlmReadinessError } from '../ts/libs/translatorFactory';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../projectRoot';
import { buildMcpConnectionCommands } from '../agent/mcpConnection';
import {
  MutationApprovalRuntimeError,
  type MutationApprovalRuntime,
} from '../agent/mutationApprovalRuntime';
import type { MutationApprovalOperationResult } from '../types/agentWorkspace';

/**
 * Handlers for agent workspace surfaces that need main-process capabilities.
 * Status handlers are read-only; MCP setup performs a user-initiated copy under
 * .llm-tsukuru-agent and never spawns a process or modifies game data.
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
      mcpServerBundleAvailable: fs.existsSync(path.join(PROJECT_ROOT, 'res', 'mcp-agent-server.cjs')),
    });
  });

  // Copies the bundled project-protecting MCP server to a stable path inside the
  // selected project and returns CLI registration commands. This user-initiated
  // setup write is scoped to the trusted workspace and never spawns anything.
  ipcMain.handle('prepareAgentMcpConnection', () => {
    const projectRoot = ctx.currentTerminalProjectRoot
      || ctx.terminalProjectRoots[ctx.terminalProjectRoots.length - 1]
      || '';
    if (!projectRoot) {
      return { ok: false, reason: '먼저 프로젝트 폴더를 선택하세요.' };
    }
    const bridge = ctx.agentBridgeServer;
    if (!bridge?.isReady() || !fs.existsSync(bridge.manifestPath)) {
      return { ok: false, reason: '앱 로컬 승인 브리지가 준비되지 않았습니다. 프로젝트를 다시 선택하세요.' };
    }
    const bundleSource = path.join(PROJECT_ROOT, 'res', 'mcp-agent-server.cjs');
    if (!fs.existsSync(bundleSource)) {
      return { ok: false, reason: 'MCP 서버 번들을 찾을 수 없습니다. 앱을 다시 빌드하세요 (npm run build:mcp).' };
    }
    const destFile = path.join(projectRoot, '.llm-tsukuru-agent', 'mcp-agent-server.cjs');
    try {
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(bundleSource, destFile);
    } catch (error) {
      return { ok: false, reason: `서버 파일 복사 실패: ${(error as Error).message}` };
    }
    return {
      ok: true,
      commands: buildMcpConnectionCommands(destFile, bridge.manifestPath),
    };
  });

  ipcMain.handle('mutationApprovalSubmit', (_event, request: unknown) => {
    return handleMutationApproval(ctx.mutationApprovalRuntime, (runtime) => ({
      approval: runtime.submit(request, 'renderer'),
    }));
  });

  ipcMain.handle('mutationApprovalList', (_event, request: unknown) => {
    return handleMutationApproval(ctx.mutationApprovalRuntime, (runtime) => {
      const approvals = runtime.list(request);
      return {
        approvals,
        snapshot: {
          schemaVersion: 1,
          approvals,
          pendingCount: approvals.filter((approval) => approval.status === 'pending').length,
        },
      };
    });
  });

  ipcMain.handle('mutationApprovalGet', (_event, request: unknown) => {
    return handleMutationApproval(ctx.mutationApprovalRuntime, (runtime) => ({
      approval: runtime.get(request),
    }));
  });

  ipcMain.handle('mutationApprovalApprove', async (_event, request: unknown) => {
    return handleMutationApprovalAsync(ctx.mutationApprovalRuntime, async (runtime) => ({
      approval: await runtime.approve(request),
    }));
  });

  ipcMain.handle('mutationApprovalDeny', (_event, request: unknown) => {
    return handleMutationApproval(ctx.mutationApprovalRuntime, (runtime) => ({
      approval: runtime.deny(request),
    }));
  });
}

function handleMutationApproval(
  runtime: MutationApprovalRuntime | null,
  action: (runtime: MutationApprovalRuntime) => Omit<MutationApprovalOperationResult, 'schemaVersion' | 'ok'>,
): MutationApprovalOperationResult {
  if (!runtime) return mutationApprovalFailure('runtime-unavailable', '먼저 프로젝트 폴더를 선택하세요.');
  try {
    return { schemaVersion: 1, ok: true, ...action(runtime) };
  } catch (error) {
    return mutationApprovalErrorResult(error);
  }
}

async function handleMutationApprovalAsync(
  runtime: MutationApprovalRuntime | null,
  action: (runtime: MutationApprovalRuntime) => Promise<Omit<MutationApprovalOperationResult, 'schemaVersion' | 'ok'>>,
): Promise<MutationApprovalOperationResult> {
  if (!runtime) return mutationApprovalFailure('runtime-unavailable', '먼저 프로젝트 폴더를 선택하세요.');
  try {
    return { schemaVersion: 1, ok: true, ...await action(runtime) };
  } catch (error) {
    return mutationApprovalErrorResult(error);
  }
}

function mutationApprovalErrorResult(error: unknown): MutationApprovalOperationResult {
  if (error instanceof MutationApprovalRuntimeError) {
    return mutationApprovalFailure(error.code, error.message);
  }
  return mutationApprovalFailure('internal-error', '승인 요청을 안전하게 처리하지 못했습니다.');
}

function mutationApprovalFailure(errorCode: string, message: string): MutationApprovalOperationResult {
  return { schemaVersion: 1, ok: false, errorCode, message };
}
