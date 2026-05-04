#!/usr/bin/env node
const {
  assert,
  buildMainIfNeeded,
  loadCompiledModule,
  writeFatalHarnessResult,
  writeHarnessResult,
} = require('./_shared.cjs');

async function main() {
  buildMainIfNeeded();

  const translatorFactory = loadCompiledModule('src/ts/libs/translatorFactory.js');
  const translationCore = loadCompiledModule('src/ts/libs/translationCore.js');
  const llmProviderConfig = loadCompiledModule('src/ts/libs/llmProviderConfig.js');

  const provider = process.env.LLM_HARNESS_PROVIDER || (process.env.VERTEX_SERVICE_ACCOUNT_JSON ? 'vertex' : 'gemini');
  const model = process.env.LLM_HARNESS_MODEL || '';
  const settingsByProvider = {
    gemini: {
      llmProvider: 'gemini',
      llmApiKey: process.env.GEMINI_API_KEY || '',
      llmModel: model,
    },
    vertex: {
      llmProvider: 'vertex',
      llmModel: model,
      llmVertexServiceAccountJson: process.env.VERTEX_SERVICE_ACCOUNT_JSON || '',
      llmVertexLocation: process.env.VERTEX_LOCATION || 'global',
    },
    openai: {
      llmProvider: 'openai',
      llmOpenAiApiKey: process.env.OPENAI_API_KEY || '',
      llmModel: model,
    },
    'custom-openai': {
      llmProvider: 'custom-openai',
      llmCustomApiKey: process.env.CUSTOM_OPENAI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || '',
      llmCustomBaseUrl: process.env.CUSTOM_OPENAI_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || '',
      llmModel: model,
    },
    claude: {
      llmProvider: 'claude',
      llmClaudeApiKey: process.env.CLAUDE_API_KEY || '',
      llmModel: model,
      llmMaxTokens: Number(process.env.CLAUDE_MAX_TOKENS || 2048),
    },
  };
  const settings = settingsByProvider[provider] || settingsByProvider.gemini;
  const readiness = llmProviderConfig.validateLlmSettings(settings);

  if (!readiness.llmReady) {
    writeHarnessResult('harness-live', {
      suite: 'harness-live',
      status: 'skipped',
      provider: settings.llmProvider,
      reason: 'required live-provider credentials or model were not supplied',
      completedAt: new Date().toISOString(),
      cases: [],
      metrics: {
        credentialsPresent: readiness.llmValidationErrors.length === 0,
        modelPresent: Boolean(model),
        validationErrors: readiness.llmValidationErrors,
      },
      failureHints: [
        'Set provider credentials plus LLM_HARNESS_MODEL to run the opt-in live harness.',
      ],
    });
    return;
  }

  const translator = translatorFactory.createTranslator(settings, 'ja', 'ko');
  const original = '--- 101 ---\nこんにちは\n\\V[1]';
  const translated = await translator.translateText(original);
  const validation = translationCore.validateChunk(translationCore.splitIntoBlocks(original), translated);

  assert(translated.trim().length > 0, 'live translation returned empty text');

  const passed = validation.blockValidations.every((item) => item.lineCountMatch && item.separatorMatch);
  const result = {
    suite: 'harness-live',
    status: passed ? 'passed' : 'failed',
    provider: settings.llmProvider,
    model,
    completedAt: new Date().toISOString(),
    cases: [{
      id: 'live-translation-smoke',
      title: 'live provider preserves separator and line-count invariants',
      status: passed ? 'passed' : 'failed',
      durationMs: 0,
      details: {
        provider: settings.llmProvider,
        model,
      },
      ...(passed ? {} : {
        error: {
          message: 'Live provider output failed separator or line-count validation.',
        },
      }),
    }],
    metrics: {
      separatorMatch: validation.blockValidations.every((item) => item.separatorMatch),
      lineCountMatch: validation.blockValidations.every((item) => item.lineCountMatch),
      outputPreview: translated.slice(0, 200),
    },
  };

  writeHarnessResult('harness-live', result);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}

main().catch((error) => {
  writeFatalHarnessResult('harness-live', error);
  process.exitCode = 1;
});
