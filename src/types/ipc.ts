export const SEND_CHANNELS = [
  'close', 'minimize', 'select_folder', 'setheight', 'extract', 'apply',
  'changeURL', 'settings', 'applysettings', 'closesettings',
   'openLLMSettings', 'llmSettingsApply', 'llmSettingsClose', 'abortLLM',
   'scanGuidelineProfile', 'generateGuidelineDraft', 'applyGuidelineDraft', 'cancelGuidelineGeneration',
   'openLLMCompare', 'llmCompareClose', 'openJsonVerify',
  'retranslateFile', 'retranslateBlocks', 'verifyLlmRepair',
  'openFolder', 'projectConvert', 'license', 'app_version',
  'getextention', 'selFont', 'changeFontSize', 'updateVersion',
  'wolf_ext', 'wolf_apply', 'gamePatcher',
  'compareReady', 'verifyReady',
  'llmSettingsReady', 'settingsReady', 'mainReady',
] as const;

export const RECEIVE_CHANNELS = [
  'set_path', 'getGlobalSettings', 'loadingTag', 'loading', 'worked',
  'check_force', 'alert', 'alert_free', 'alert2',
  'llmTranslating', 'alertExten', 'settings', 'llmSettings',
  'initCompare', 'retranslateProgress', 'retranslateFileDone', 'retranslateBlocksDone',
  'initVerify', 'verifySettings', 'verifyLlmRepairProgress', 'verifyLlmRepairDone',
  'set-allowed-paths',
] as const;

export type SendChannel = typeof SEND_CHANNELS[number];
export type ReceiveChannel = typeof RECEIVE_CHANNELS[number];

export function isSendChannel(channel: string): channel is SendChannel {
  return (SEND_CHANNELS as readonly string[]).includes(channel);
}

export function isReceiveChannel(channel: string): channel is ReceiveChannel {
  return (RECEIVE_CHANNELS as readonly string[]).includes(channel);
}

export interface AlertPayload {
  icon: 'error' | 'success' | 'warning' | 'info';
  message: string;
}

export interface ExtractArg {
  path: string;
  type?: string;
}

export interface ProgressPayload {
  now: number;
  max: number;
}

export interface SetPathPayload {
  type: string;
  dir: string;
}
