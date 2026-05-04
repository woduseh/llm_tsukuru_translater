import {
  type AppSettings,
  DEFAULT_LLM_VERTEX_LOCATION,
} from '../../types/settings';
import { settings as defaultSettings } from '../rpgmv/datas';
import { isBoolean, isNumber, isRecord, isString } from '../../types/guards';
import { isKnownLlmProvider } from './providerRegistry';

const BOOLEAN_KEYS = [
  'extractJs',
  'extractSomeScript',
  'code122',
  'onefile_src',
  'onefile_note',
  'exJson',
  'loadingText',
  'JsonChangeLine',
  'ExtractAddLine',
  'oneMapFile',
  'ExternMsgJson',
  'DoNotTransHangul',
  'formatNice',
  'HideExtractAll',
] as const;

const STRING_KEYS = [
  'language',
  'llmApiKey',
  'llmOpenAiApiKey',
  'llmCustomApiKey',
  'llmCustomBaseUrl',
  'llmClaudeApiKey',
  'llmModel',
  'llmCustomPrompt',
  'llmSourceLang',
  'llmTargetLang',
  'llmVertexServiceAccountJson',
] as const;

const STRING_ARRAY_KEYS = [
  'extractSomeScript2',
] as const;

const NUMBER_ARRAY_KEYS = [
  'extractPlus',
] as const;

const INTEGER_RANGE_RULES = {
  llmChunkSize: { min: 1, max: 200 },
  llmMaxRetries: { min: 0, max: 10 },
  llmMaxApiRetries: { min: 0, max: 20 },
  llmTimeout: { min: 30, max: 3600 },
  llmMaxTokens: { min: 1, max: 200000 },
  llmParallelWorkers: { min: 1, max: 16 },
} as const;

const TRANSLATION_UNITS = ['chunk', 'file'] as const;
const SORT_ORDERS = ['name-asc', 'name-desc', 'size-asc', 'size-desc'] as const;
const DERIVED_KEYS = new Set(['themeData', 'themeList', 'version']);

function createDefaultSettings(): AppSettings {
  return {
    ...defaultSettings,
    extractSomeScript2: [...defaultSettings.extractSomeScript2],
    extractPlus: [...defaultSettings.extractPlus],
    themeData: { ...defaultSettings.themeData },
    themeList: [...defaultSettings.themeList],
  };
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => isNumber(item) && Number.isInteger(item));
}

function normalizeVertexLocation(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : DEFAULT_LLM_VERTEX_LOCATION;
}

function createInvalidSettingError(key: string, reason: string): Error {
  return new Error(`설정 값이 올바르지 않습니다 (${key}): ${reason}`);
}

function validateSettingValue(
  current: AppSettings,
  key: string,
  value: unknown,
  strict: boolean,
): unknown {
  const invalid = (reason: string) => {
    if (strict) {
      throw createInvalidSettingError(key, reason);
    }
    return undefined;
  };

  if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
    return isBoolean(value) ? value : invalid('boolean 값이 필요합니다');
  }

  if ((STRING_KEYS as readonly string[]).includes(key)) {
    return isString(value) ? value : invalid('string 값이 필요합니다');
  }

  if ((STRING_ARRAY_KEYS as readonly string[]).includes(key)) {
    return isStringArray(value) ? [...value] : invalid('string[] 값이 필요합니다');
  }

  if ((NUMBER_ARRAY_KEYS as readonly string[]).includes(key)) {
    return isIntegerArray(value) ? [...value] : invalid('정수 배열이 필요합니다');
  }

  if (key in INTEGER_RANGE_RULES) {
    const rule = INTEGER_RANGE_RULES[key as keyof typeof INTEGER_RANGE_RULES];
    return isIntegerInRange(value, rule.min, rule.max)
      ? value
      : invalid(`${rule.min}~${rule.max} 범위의 정수가 필요합니다`);
  }

  if (key === 'llmProvider') {
    return isKnownLlmProvider(value)
      ? value
      : invalid('지원하는 LLM 제공자만 허용됩니다');
  }

  if (key === 'theme') {
    return isString(value) && current.themeList.includes(value)
      ? value
      : invalid('알 수 없는 테마입니다');
  }

  if (key === 'llmTranslationUnit') {
    return isString(value) && TRANSLATION_UNITS.includes(value as (typeof TRANSLATION_UNITS)[number])
      ? value
      : invalid('chunk 또는 file만 허용됩니다');
  }

  if (key === 'llmSortOrder') {
    return isString(value) && SORT_ORDERS.includes(value as (typeof SORT_ORDERS)[number])
      ? value
      : invalid('알 수 없는 정렬 순서입니다');
  }

  if (key === 'llmVertexLocation') {
    return isString(value) ? normalizeVertexLocation(value) : invalid('string 값이 필요합니다');
  }

  if (DERIVED_KEYS.has(key)) {
    return undefined;
  }

  if (strict) {
    throw createInvalidSettingError(key, '알 수 없는 설정 키입니다');
  }

  return undefined;
}

export function sanitizeStoredSettings(storedSettings: unknown): AppSettings {
  const sanitized = createDefaultSettings();
  if (!isRecord(storedSettings)) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(storedSettings)) {
    const nextValue = validateSettingValue(sanitized, key, value, false);
    if (nextValue !== undefined) {
      (sanitized as Record<string, unknown>)[key] = nextValue;
    }
  }

  sanitized.themeList = [...defaultSettings.themeList];
  return sanitized;
}

export function applyValidatedSettingsUpdate(current: AppSettings, update: unknown): AppSettings {
  if (!isRecord(update)) {
    throw new Error('설정 업데이트 payload는 객체여야 합니다.');
  }

  const next = sanitizeStoredSettings(current);
  next.version = current.version;

  for (const [key, value] of Object.entries(update)) {
    const nextValue = validateSettingValue(next, key, value, true);
    if (nextValue !== undefined) {
      (next as Record<string, unknown>)[key] = nextValue;
    }
  }

  next.themeList = [...defaultSettings.themeList];
  return next;
}
