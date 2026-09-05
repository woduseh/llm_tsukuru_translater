import type { AppSettings } from '../../types/settings';
import type { LlmProviderSecretSettingKey } from '../../types/llmProviderContract';
import {
  getAllProviderSecretSettingKeys,
  getProviderRegistryEntry,
  validateProviderReadiness,
  type ProviderReadinessValidation,
} from './providerRegistry';
export {
  parseVertexServiceAccountJson,
  type VertexServiceAccountJson,
} from './vertexCredentials';

export type LlmSettingsValidation = ProviderReadinessValidation;

export interface LlmStartWindowState extends Pick<LlmSettingsValidation, 'llmProvider' | 'llmVertexLocation' | 'llmReady' | 'llmHasApiKey' | 'llmHasVertexServiceAccountJson'> {
  llmSortOrder: string;
  llmParallelWorkers: number;
  llmSourceLang: string;
  llmTargetLang: string;
  llmCustomPrompt: string;
  themeData: Record<string, string>;
}

export interface VerifyWindowState extends Pick<LlmSettingsValidation, 'llmProvider' | 'llmVertexLocation' | 'llmReady' | 'llmHasApiKey' | 'llmHasVertexServiceAccountJson'> {
  JsonChangeLine: boolean;
  themeData: Record<string, string>;
}

type SanitizedSettings<T extends Record<string, unknown>> = Omit<T, LlmProviderSecretSettingKey>;

function getProviderMetadata(settings: AppSettings): Pick<LlmSettingsValidation, 'llmProvider' | 'llmVertexLocation' | 'llmReady' | 'llmHasApiKey' | 'llmHasVertexServiceAccountJson'> {
  const validation = validateLlmSettings(settings);
  return {
    llmProvider: validation.llmProvider,
    llmVertexLocation: validation.llmVertexLocation,
    llmReady: validation.llmReady,
    llmHasApiKey: validation.llmHasApiKey,
    llmHasVertexServiceAccountJson: validation.llmHasVertexServiceAccountJson,
  };
}

export function getLlmProviderConfigHint(provider: unknown): string {
  return getProviderRegistryEntry(provider).configHint;
}

export function getLlmProviderMissingConfigMessage(provider: unknown): string {
  return getProviderRegistryEntry(provider).missingConfigMessage;
}

export function sanitizeSettingsForRenderer<T extends Record<string, unknown>>(settings: T): SanitizedSettings<T> {
  const safeSettings: Record<string, unknown> = { ...settings };
  for (const key of getAllProviderSecretSettingKeys()) {
    delete safeSettings[key];
  }
  return safeSettings as SanitizedSettings<T>;
}

export function validateLlmSettings(settings: AppSettings): LlmSettingsValidation {
  return validateProviderReadiness(settings);
}

export function buildLlmStartWindowState(settings: AppSettings): LlmStartWindowState {
  return {
    llmSortOrder: settings.llmSortOrder || 'name-asc',
    llmParallelWorkers: settings.llmParallelWorkers || 1,
    llmSourceLang: settings.llmSourceLang || 'ja',
    llmTargetLang: settings.llmTargetLang || 'ko',
    llmCustomPrompt: settings.llmCustomPrompt || '',
    themeData: settings.themeData || {},
    ...getProviderMetadata(settings),
  };
}

export function buildVerifyWindowState(settings: AppSettings): VerifyWindowState {
  return {
    JsonChangeLine: !!settings.JsonChangeLine,
    themeData: settings.themeData || {},
    ...getProviderMetadata(settings),
  };
}
