import { describe, expect, it, vi } from 'vitest';
import {
  buildVertexApiUrl,
  createVertexAccessTokenProvider,
  createVertexTranslator,
} from '../../src/ts/libs/vertexTranslator';

const validServiceAccount = {
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
};

const baseSettings = {
  llmVertexServiceAccountJson: JSON.stringify(validServiceAccount),
  llmVertexLocation: 'global',
  llmModel: 'gemini-2.5-pro',
  llmCustomPrompt: '',
  llmChunkSize: 30,
  llmTranslationUnit: 'chunk',
  DoNotTransHangul: false,
  llmMaxRetries: 2,
  llmMaxApiRetries: 5,
  llmTimeout: 600,
};

describe('buildVertexApiUrl', () => {
  it('builds the global endpoint without a regional hostname prefix', () => {
    expect(buildVertexApiUrl('vertex-project', 'global', 'gemini-2.5-pro')).toBe(
      'https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-2.5-pro:generateContent',
    );
  });

  it('builds regional endpoints with the location hostname prefix', () => {
    expect(buildVertexApiUrl('vertex-project', 'us-central1', 'gemini-2.5-pro')).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
    );
  });
});

describe('createVertexAccessTokenProvider', () => {
  it('requests a cloud-platform token using the parsed service account JSON', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 'access-token' });
    const getClient = vi.fn().mockResolvedValue({ getAccessToken });
    const createGoogleAuth = vi.fn().mockReturnValue({ getClient });

    const provideAccessToken = createVertexAccessTokenProvider(validServiceAccount, { createGoogleAuth });

    await expect(provideAccessToken()).resolves.toBe('access-token');
    expect(createGoogleAuth).toHaveBeenCalledWith({
      credentials: validServiceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  });

  it('reuses the same GoogleAuth instance across multiple token requests', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 'access-token' });
    const getClient = vi.fn().mockResolvedValue({ getAccessToken });
    const createGoogleAuth = vi.fn().mockReturnValue({ getClient });

    const provideAccessToken = createVertexAccessTokenProvider(validServiceAccount, { createGoogleAuth });

    await expect(provideAccessToken()).resolves.toBe('access-token');
    await expect(provideAccessToken()).resolves.toBe('access-token');

    expect(createGoogleAuth).toHaveBeenCalledTimes(1);
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe('createVertexTranslator', () => {
  it('throws when the service account JSON is invalid', () => {
    expect(() => createVertexTranslator({
      ...baseSettings,
      llmVertexServiceAccountJson: 'not-json',
    }, 'ja', 'ko')).toThrow('Vertex service account JSON could not be parsed.');
  });

  it('translates text with bearer auth and returns the first candidate text', async () => {
    const post = vi.fn().mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: '  translated text  ' }],
            },
          },
        ],
      },
    });

    const translator = createVertexTranslator(
      baseSettings,
      'ja',
      'ko',
      undefined,
      {
        httpClient: { post },
        accessTokenProvider: async () => 'access-token',
      },
    );

    await expect(translator.translateText('hello')).resolves.toBe('translated text');
    expect(post).toHaveBeenCalledWith(
      'https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-2.5-pro:generateContent',
      expect.objectContaining({
        systemInstruction: expect.any(Object),
        contents: expect.any(Array),
        safetySettings: expect.any(Array),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
    );
  });

  it('surfaces provider-specific authentication failures', async () => {
    const translator = createVertexTranslator(
      baseSettings,
      'ja',
      'ko',
      undefined,
      {
        httpClient: { post: vi.fn() },
        accessTokenProvider: async () => {
          throw new Error('invalid_grant: service account is disabled');
        },
      },
    );

    await expect(translator.translateText('hello')).rejects.toThrow(
      'Vertex AI authentication failed: invalid_grant: service account is disabled',
    );
  });

  it('treats authentication failures as permanent during file translation', async () => {
    const post = vi.fn().mockRejectedValue({
      response: {
        status: 403,
        data: {
          error: {
            message: 'Permission denied on Vertex AI resource',
          },
        },
      },
      message: 'Request failed with status code 403',
    });

    const translator = createVertexTranslator(
      baseSettings,
      'ja',
      'ko',
      undefined,
      {
        httpClient: { post },
        accessTokenProvider: async () => 'access-token',
      },
    );

    const result = await translator.translateFileContent('hello');

    expect(result.translatedContent).toBe('hello');
    expect(result.logEntry.skippedBlocks).toBe(1);
    expect(result.logEntry.retries).toBe(0);
    expect(result.logEntry.errors?.[0]).toContain('Vertex AI authentication failed');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
