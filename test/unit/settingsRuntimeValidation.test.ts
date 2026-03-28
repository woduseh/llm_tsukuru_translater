import { describe, expect, it } from 'vitest';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import {
  applyValidatedSettingsUpdate,
  sanitizeStoredSettings,
} from '../../src/ts/libs/settingsRuntimeValidation';

function createCurrentSettings() {
  return {
    ...defaultSettings,
    themeData: { '--mainColor': '#ffffff', '--accent': '#7c6fdb' },
    llmMaxRetries: 2,
    llmMaxApiRetries: 5,
    llmTimeout: 600,
  };
}

describe('sanitizeStoredSettings', () => {
  it('drops unknown keys and falls back to safe defaults for invalid values', () => {
    const sanitized = sanitizeStoredSettings({
      llmProvider: 'unknown',
      llmChunkSize: 0,
      llmMaxRetries: 99,
      llmMaxApiRetries: -1,
      llmTimeout: 5,
      oneMapFile: 'yes',
      llmVertexLocation: '',
      unknownSetting: 'should be dropped',
    });

    expect(sanitized.llmProvider).toBe(defaultSettings.llmProvider);
    expect(sanitized.llmChunkSize).toBe(defaultSettings.llmChunkSize);
    expect(sanitized.llmVertexLocation).toBe('global');
    expect(sanitized.oneMapFile).toBe(defaultSettings.oneMapFile);
    expect(sanitized).not.toHaveProperty('unknownSetting');
    expect(sanitized.llmMaxRetries).toBe(2);
    expect(sanitized.llmMaxApiRetries).toBe(5);
    expect(sanitized.llmTimeout).toBe(600);
  });
});

describe('applyValidatedSettingsUpdate', () => {
  it('accepts a valid partial update and normalizes blank vertex location', () => {
    const updated = applyValidatedSettingsUpdate(createCurrentSettings(), {
      llmProvider: 'vertex',
      llmChunkSize: 50,
      llmMaxRetries: 4,
      llmMaxApiRetries: 8,
      llmTimeout: 300,
      llmVertexLocation: '',
    });

    expect(updated.llmProvider).toBe('vertex');
    expect(updated.llmChunkSize).toBe(50);
    expect(updated.llmMaxRetries).toBe(4);
    expect(updated.llmMaxApiRetries).toBe(8);
    expect(updated.llmTimeout).toBe(300);
    expect(updated.llmVertexLocation).toBe('global');
  });

  it('rejects unsupported keys', () => {
    expect(() => applyValidatedSettingsUpdate(createCurrentSettings(), {
      unknownSetting: true,
    })).toThrow(/unknownSetting/);
  });

  it('rejects out-of-range numeric settings', () => {
    expect(() => applyValidatedSettingsUpdate(createCurrentSettings(), {
      llmChunkSize: 0,
    })).toThrow(/llmChunkSize/);

    expect(() => applyValidatedSettingsUpdate(createCurrentSettings(), {
      llmTimeout: 5000,
    })).toThrow(/llmTimeout/);
  });
});
