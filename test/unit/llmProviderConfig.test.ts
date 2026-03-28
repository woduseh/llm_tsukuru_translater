import { describe, expect, it } from 'vitest';
import { settings as defaultSettings } from '../../src/ts/rpgmv/datas';
import {
  buildLlmStartWindowState,
  buildVerifyWindowState,
  getLlmProviderConfigHint,
  getLlmProviderMissingConfigMessage,
  parseVertexServiceAccountJson,
  sanitizeSettingsForRenderer,
  validateLlmSettings,
} from '../../src/ts/libs/llmProviderConfig';

const validServiceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'vertex-project',
  private_key_id: 'private-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n',
  client_email: 'vertex@test-project.iam.gserviceaccount.com',
  client_id: '1234567890',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/vertex%40test-project.iam.gserviceaccount.com',
});

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultSettings,
    themeData: { '--accent': '#7c6fdb', '--mainColor': '#ffffff' },
    JsonChangeLine: true,
    llmApiKey: 'secret-api-key',
    llmModel: 'gemini-2.5-pro',
    llmSortOrder: 'size-desc',
    llmProvider: 'vertex',
    llmVertexLocation: 'global',
    llmVertexServiceAccountJson: validServiceAccountJson,
    ...overrides,
  };
}

describe('sanitizeSettingsForRenderer', () => {
  it('removes llmApiKey and llmVertexServiceAccountJson', () => {
    const settings = createSettings();

    const sanitized = sanitizeSettingsForRenderer(settings);

    expect(sanitized).not.toHaveProperty('llmApiKey');
    expect(sanitized).not.toHaveProperty('llmVertexServiceAccountJson');
    expect(sanitized).toMatchObject({
      llmProvider: 'vertex',
      llmVertexLocation: 'global',
      llmModel: 'gemini-2.5-pro',
    });
  });
});

describe('buildLlmStartWindowState', () => {
  it('exposes sort order, readiness, theme data, and provider metadata without secrets', () => {
    const state = buildLlmStartWindowState(createSettings());

    expect(state).toMatchObject({
      llmSortOrder: 'size-desc',
      llmReady: true,
      llmProvider: 'vertex',
      llmVertexLocation: 'global',
      llmHasApiKey: true,
      llmHasVertexServiceAccountJson: true,
      themeData: { '--accent': '#7c6fdb', '--mainColor': '#ffffff' },
    });
    expect(state).not.toHaveProperty('llmApiKey');
    expect(state).not.toHaveProperty('llmVertexServiceAccountJson');
  });
});

describe('buildVerifyWindowState', () => {
  it('exposes JsonChangeLine, readiness, theme data, and provider metadata without secrets', () => {
    const state = buildVerifyWindowState(createSettings());

    expect(state).toMatchObject({
      JsonChangeLine: true,
      llmReady: true,
      llmProvider: 'vertex',
      llmVertexLocation: 'global',
      llmHasApiKey: true,
      llmHasVertexServiceAccountJson: true,
      themeData: { '--accent': '#7c6fdb', '--mainColor': '#ffffff' },
    });
    expect(state).not.toHaveProperty('llmApiKey');
    expect(state).not.toHaveProperty('llmVertexServiceAccountJson');
  });
});

describe('parseVertexServiceAccountJson', () => {
  it('accepts a valid pasted JSON key', () => {
    const parsed = parseVertexServiceAccountJson(validServiceAccountJson);

    expect(parsed.project_id).toBe('vertex-project');
    expect(parsed.client_email).toBe('vertex@test-project.iam.gserviceaccount.com');
    expect(parsed.private_key).toContain('BEGIN PRIVATE KEY');
  });
});

describe('validateLlmSettings', () => {
  it('uses the default global Vertex location when the stored setting is blank', () => {
    const validation = validateLlmSettings(
      createSettings({
        llmApiKey: '',
        llmVertexLocation: '',
      }),
    );

    expect(validation.llmVertexLocation).toBe('global');
    expect(validation.llmReady).toBe(true);
    expect(validation.llmValidationErrors).not.toContain('Vertex location is required.');
  });

  it.each(['client_email', 'private_key', 'project_id'])(
    'fails validation when %s is missing',
    (missingField) => {
      const parsed = JSON.parse(validServiceAccountJson) as Record<string, unknown>;
      delete parsed[missingField];

      const validation = validateLlmSettings(
        createSettings({
          llmApiKey: '',
          llmVertexServiceAccountJson: JSON.stringify(parsed),
        }),
      );

      expect(validation.llmReady).toBe(false);
      expect(validation.llmValidationErrors.join(' ')).toContain(missingField);
    },
  );

  it('fails validation when the Gemini API key is missing', () => {
    const validation = validateLlmSettings(
      createSettings({
        llmProvider: 'gemini',
        llmApiKey: '',
        llmVertexServiceAccountJson: '',
      }),
    );

    expect(validation.llmReady).toBe(false);
    expect(validation.llmValidationErrors).toContain('Gemini API key is required.');
  });
});

describe('provider UI helpers', () => {
  it('returns provider-specific setup hints for the settings page', () => {
    expect(getLlmProviderConfigHint('gemini')).toContain('Gemini API 키');
    expect(getLlmProviderConfigHint('vertex')).toContain('서비스 계정 JSON');
    expect(getLlmProviderConfigHint('vertex')).toContain('global');
  });

  it('returns provider-specific missing-config messages for renderer dialogs', () => {
    expect(getLlmProviderMissingConfigMessage('gemini')).toContain('Gemini API 설정');
    expect(getLlmProviderMissingConfigMessage('vertex')).toContain('Vertex AI 설정');
  });
});
