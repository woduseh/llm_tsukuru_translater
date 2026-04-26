#!/usr/bin/env node
const {
  assert,
  buildMainIfNeeded,
  loadCompiledModule,
  resolveOutputPath,
  writeJson,
} = require('./_shared.cjs');

async function main() {
  buildMainIfNeeded();

  const translatorFactory = loadCompiledModule('src/ts/libs/translatorFactory.js');
  const translationCore = loadCompiledModule('src/ts/libs/translationCore.js');

  const provider = process.env.LLM_HARNESS_PROVIDER || (process.env.VERTEX_SERVICE_ACCOUNT_JSON ? 'vertex' : 'gemini');
  const model = process.env.LLM_HARNESS_MODEL || '';
  const outputPath = resolveOutputPath('harness-live');

  const missingGemini = provider === 'gemini' && (!process.env.GEMINI_API_KEY || !model);
  const missingVertex = provider === 'vertex' && (!process.env.VERTEX_SERVICE_ACCOUNT_JSON || !model);

  if (missingGemini || missingVertex) {
    writeJson(outputPath, {
      suite: 'harness-live',
      status: 'skipped',
      provider,
      reason: 'required live-provider credentials or model were not supplied',
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const settings = provider === 'vertex'
    ? {
      llmProvider: 'vertex',
      llmModel: model,
      llmVertexServiceAccountJson: process.env.VERTEX_SERVICE_ACCOUNT_JSON,
      llmVertexLocation: process.env.VERTEX_LOCATION || 'global',
    }
    : {
      llmProvider: 'gemini',
      llmApiKey: process.env.GEMINI_API_KEY,
      llmModel: model,
    };

  const translator = translatorFactory.createTranslator(settings, 'ja', 'ko');
  const original = '--- 101 ---\nこんにちは\n\\V[1]';
  const translated = await translator.translateText(original);
  const validation = translationCore.validateChunk(translationCore.splitIntoBlocks(original), translated);

  assert(translated.trim().length > 0, 'live translation returned empty text');

  const result = {
    suite: 'harness-live',
    status: validation.blockValidations.every((item) => item.lineCountMatch && item.separatorMatch) ? 'passed' : 'failed',
    provider,
    model,
    completedAt: new Date().toISOString(),
    metrics: {
      separatorMatch: validation.blockValidations.every((item) => item.separatorMatch),
      lineCountMatch: validation.blockValidations.every((item) => item.lineCountMatch),
      outputPreview: translated.slice(0, 200),
    },
  };

  writeJson(outputPath, result);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}

main().catch((error) => {
  const outputPath = resolveOutputPath('harness-live');
  writeJson(outputPath, {
    suite: 'harness-live',
    status: 'failed',
    fatal: true,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
  process.exitCode = 1;
});
