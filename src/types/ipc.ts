import type {
  MutationApprovalApproveRequest, MutationApprovalDenyRequest, MutationApprovalGetRequest,
  MutationApprovalListRequest, MutationApprovalOperationResult, MutationApprovalQueueSnapshot,
  PatchApplyProposalRequest, TerminalEvent, TerminalInputRequest, TerminalKillRequest,
  TerminalOperationResult, TerminalResizeRequest, TerminalSessionCreateRequest, TerminalSnapshotRequest,
} from './agentWorkspace';
import type { AppSettings } from './settings';
import type { ApplyArg, ExtractArg, VersionUpRequest } from '../ts/rpgmv/types';
import type { WolfExtractConfig } from '../ts/wolf/types';
import type { ReviewedTextWriteRequest, ReviewedTextWriteResult } from '../ts/rpgmv/reviewTextWrite';
import type { ProjectTranslationProfile } from '../ts/libs/projectProfile';
import type { GuidelineGenerationResult } from '../ts/libs/guidelineGenerator';
import type { LlmStartWindowState, VerifyWindowState } from '../ts/libs/llmProviderConfig';
import type { AgentExecutableDetectionRequestItem, AgentExecutableDetectionResult } from '../agent/agentExecutableDetection';
import type { AgentWorkspaceStatus } from '../agent/agentWorkspaceStatus';
import type { McpConnectionCommands } from '../agent/mcpConnection';

export interface RetranslateIpcRequest {
  dir: string;
  fileName: string;
  requestId: string;
  expectedContent: string;
}

export interface RetranslateIpcResult {
  success: boolean;
  error?: string;
  requestId?: string;
  fileName?: string;
}

export interface RetranslateIpcProgress {
  requestId?: string;
  fileName?: string;
  message: string;
}

export interface VerifyApplyJsonRequest {
  requestId: string;
  fileName: string;
  targetPath: string;
  expectedContent: string;
  nextContent: string;
}

export interface VerifyApplyJsonResult {
  requestId: string;
  fileName: string;
  targetPath: string;
  success: boolean;
  error?: string;
}

export interface LlmRepairItem {
  path: string;
  origText: string;
}

export interface LlmRepairRequest {
  requestId: string;
  items: LlmRepairItem[];
}

export interface LlmSettingsApplyRequest {
  llmResetProgress: boolean;
  llmSortOrder: string;
  llmParallelWorkers: number;
  llmRequestsPerMinute: number;
  llmTranslationMode: string;
}

export interface McpConnectionResult {
  ok: boolean;
  reason?: string;
  commands?: McpConnectionCommands;
}

/** Renderer-to-main events. Runtime handlers still validate untrusted input. */
export interface SendArgs {
  close: [];
  minimize: [];
  select_folder: [inputId: string];
  setheight: [height: number];
  extract: [request: ExtractArg];
  apply: [request: ApplyArg];
  changeURL: [route: string];
  settings: [];
  applysettings: [settings: Partial<AppSettings>];
  closesettings: [];
  openLLMSettings: [project: { dir: string; game: 'mvmz' | 'wolf' }];
  llmSettingsApply: [request: LlmSettingsApplyRequest];
  llmSettingsClose: [];
  abortLLM: [];
  cancelGuidelineGeneration: [];
  openLLMCompare: [dir: string];
  llmCompareClose: [];
  openJsonVerify: [dir: string];
  retranslateFile: [request: RetranslateIpcRequest];
  retranslateBlocks: [request: RetranslateIpcRequest & { blockIndices: number[] }];
  verifyLlmRepair: [request: LlmRepairRequest];
  verifyApplyJson: [request: VerifyApplyJsonRequest];
  openFolder: [path: string];
  projectConvert: [path: string];
  license: [];
  app_version: [];
  getextention: [extension: string];
  selFont: [dir: string];
  changeFontSize: [request: [dir: string, fontSize: number]];
  updateVersion: [request: VersionUpRequest];
  wolf_ext: [request: { folder: string; config?: WolfExtractConfig }];
  wolf_apply: [request: { folder: string }];
  compareReady: [options?: { fresh?: boolean }];
  verifyReady: [options?: { fresh?: boolean }];
  llmSettingsReady: [];
  settingsReady: [];
  mainReady: [];
}

/** Request/reply channels, separate from send-only events. */
export interface InvokeContracts {
  scanGuidelineProfile: { args: []; result: ProjectTranslationProfile };
  generateGuidelineDraft: { args: [request: { profile: ProjectTranslationProfile }]; result: GuidelineGenerationResult };
  applyGuidelineDraft: { args: [request: { guideline: string; mode?: 'append' | 'replace' }]; result: { success: boolean; llmCustomPrompt: string } };
  compareSaveText: { args: [request: ReviewedTextWriteRequest]; result: ReviewedTextWriteResult };
  terminalCreate: { args: [request: TerminalSessionCreateRequest]; result: TerminalOperationResult };
  terminalInput: { args: [request: TerminalInputRequest]; result: TerminalOperationResult };
  terminalResize: { args: [request: TerminalResizeRequest]; result: TerminalOperationResult };
  terminalKill: { args: [request: TerminalKillRequest]; result: TerminalOperationResult };
  terminalList: { args: []; result: TerminalOperationResult };
  terminalSnapshot: { args: [request: TerminalSnapshotRequest]; result: TerminalOperationResult };
  detectAgentExecutables: { args: [items: AgentExecutableDetectionRequestItem[]]; result: AgentExecutableDetectionResult };
  getAgentWorkspaceStatus: { args: []; result: AgentWorkspaceStatus };
  prepareAgentMcpConnection: { args: []; result: McpConnectionResult };
  mutationApprovalSubmit: { args: [request: PatchApplyProposalRequest]; result: MutationApprovalOperationResult };
  mutationApprovalList: { args: [request: MutationApprovalListRequest]; result: MutationApprovalOperationResult };
  mutationApprovalGet: { args: [request: MutationApprovalGetRequest]; result: MutationApprovalOperationResult };
  mutationApprovalApprove: { args: [request: MutationApprovalApproveRequest]; result: MutationApprovalOperationResult };
  mutationApprovalDeny: { args: [request: MutationApprovalDenyRequest]; result: MutationApprovalOperationResult };
}

/** Main-to-renderer payloads; Electron's event object stays in preload. */
export interface ReceiveArgs {
  set_path: [payload: SetPathPayload];
  getGlobalSettings: [settings: Partial<AppSettings>];
  loadingTag: [label: string];
  loading: [progress: number];
  worked: [value: number];
  check_force: [request: ExtractArg];
  alert: [payload: AlertPayload | string];
  alert_free: [payload: unknown];
  alert2: [];
  llmTranslating: [translating: boolean];
  alertExten: [payload: [message: string, extension: string]];
  settings: [settings: AppSettings];
  llmSettings: [settings: LlmStartWindowState];
  initCompare: [dir: string];
  retranslateProgress: [payload: RetranslateIpcProgress];
  retranslateFileDone: [payload: RetranslateIpcResult];
  retranslateBlocksDone: [payload: RetranslateIpcResult];
  initVerify: [dir: string];
  verifySettings: [settings: VerifyWindowState];
  verifyLlmRepairProgress: [payload: { requestId: string; current: number; total: number; path: string }];
  verifyLlmRepairDone: [payload: { requestId: string; success: boolean; results?: (LlmRepairItem & { newText: string })[]; error?: string }];
  verifyApplyJsonDone: [payload: VerifyApplyJsonResult];
  'set-allowed-paths': [paths: string[]];
  'replace-allowed-paths': [paths: string[]];
  terminalEvent: [event: TerminalEvent];
  terminalSessions: [result: TerminalOperationResult];
  approvalQueueChanged: [snapshot: MutationApprovalQueueSnapshot];
  workspaceNavigate: [payload: { route: string }];
  settingsSaved: [settings: AppSettings];
  settingsSaveFailed: [];
  llmSettingsApplyResult: [result: { success: boolean }];
}

export type SendChannel = keyof SendArgs;
export type InvokeChannel = keyof InvokeContracts;
export type ReceiveChannel = keyof ReceiveArgs;
export type IpcCallback<C extends ReceiveChannel> = (...args: ReceiveArgs[C]) => void;

export const SEND_CHANNELS = [
  'close', 'minimize', 'select_folder', 'setheight', 'extract', 'apply',
  'changeURL', 'settings', 'applysettings', 'closesettings',
  'openLLMSettings', 'llmSettingsApply', 'llmSettingsClose', 'abortLLM', 'cancelGuidelineGeneration',
  'openLLMCompare', 'llmCompareClose', 'openJsonVerify',
  'retranslateFile', 'retranslateBlocks', 'verifyLlmRepair', 'verifyApplyJson',
  'openFolder', 'projectConvert', 'license', 'app_version',
  'getextention', 'selFont', 'changeFontSize', 'updateVersion', 'wolf_ext', 'wolf_apply',
  'compareReady', 'verifyReady', 'llmSettingsReady', 'settingsReady', 'mainReady',
] as const satisfies readonly SendChannel[];

export const INVOKE_CHANNELS = [
  'scanGuidelineProfile', 'generateGuidelineDraft', 'applyGuidelineDraft', 'compareSaveText',
  'terminalCreate', 'terminalInput', 'terminalResize', 'terminalKill', 'terminalList', 'terminalSnapshot',
  'detectAgentExecutables', 'getAgentWorkspaceStatus', 'prepareAgentMcpConnection',
  'mutationApprovalSubmit', 'mutationApprovalList', 'mutationApprovalGet',
  'mutationApprovalApprove', 'mutationApprovalDeny',
] as const satisfies readonly InvokeChannel[];

export const RECEIVE_CHANNELS = [
  'set_path', 'getGlobalSettings', 'loadingTag', 'loading', 'worked',
  'check_force', 'alert', 'alert_free', 'alert2',
  'llmTranslating', 'alertExten', 'settings', 'llmSettings',
  'initCompare', 'retranslateProgress', 'retranslateFileDone', 'retranslateBlocksDone',
  'initVerify', 'verifySettings', 'verifyLlmRepairProgress', 'verifyLlmRepairDone', 'verifyApplyJsonDone',
  'set-allowed-paths', 'replace-allowed-paths',
  'terminalEvent', 'terminalSessions', 'approvalQueueChanged',
  'workspaceNavigate', 'settingsSaved', 'settingsSaveFailed', 'llmSettingsApplyResult',
] as const satisfies readonly ReceiveChannel[];

export function isSendChannel(channel: string): channel is SendChannel {
  return (SEND_CHANNELS as readonly string[]).includes(channel);
}

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return (INVOKE_CHANNELS as readonly string[]).includes(channel);
}

export function isReceiveChannel(channel: string): channel is ReceiveChannel {
  return (RECEIVE_CHANNELS as readonly string[]).includes(channel);
}

export interface AlertPayload {
  icon: 'error' | 'success' | 'warning' | 'info';
  message: string;
}

export interface SetPathPayload {
  type: string;
  dir: string;
}

/** One contract for the preload implementation and every renderer caller. */
export interface ElectronApi {
  send<C extends SendChannel>(channel: C, ...args: SendArgs[C]): void;
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeContracts[C]['args']): Promise<InvokeContracts[C]['result']>;
  on<C extends ReceiveChannel>(channel: C, callback: IpcCallback<C>): (() => void) | undefined;
  once<C extends ReceiveChannel>(channel: C, callback: IpcCallback<C>): void;
  removeAllListeners(channel: ReceiveChannel): void;
  terminal: {
    create(request: TerminalSessionCreateRequest): Promise<TerminalOperationResult>;
    input(request: TerminalInputRequest): Promise<TerminalOperationResult>;
    resize(request: TerminalResizeRequest): Promise<TerminalOperationResult>;
    kill(request: TerminalKillRequest): Promise<TerminalOperationResult>;
    list(): Promise<TerminalOperationResult>;
    snapshot(request: TerminalSnapshotRequest): Promise<TerminalOperationResult>;
    onEvent(callback: (event: TerminalEvent) => void): () => void;
    onSessions(callback: (result: TerminalOperationResult) => void): () => void;
  };
  approvals: {
    submit(request: PatchApplyProposalRequest): Promise<MutationApprovalOperationResult>;
    list(request: MutationApprovalListRequest): Promise<MutationApprovalOperationResult>;
    get(request: MutationApprovalGetRequest): Promise<MutationApprovalOperationResult>;
    approve(request: MutationApprovalApproveRequest): Promise<MutationApprovalOperationResult>;
    deny(request: MutationApprovalDenyRequest): Promise<MutationApprovalOperationResult>;
    onChanged(callback: (snapshot: MutationApprovalQueueSnapshot) => void): () => void;
  };
}
