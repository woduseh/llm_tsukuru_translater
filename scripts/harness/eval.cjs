#!/usr/bin/env node
const path = require('path');

const {
  assert,
  buildMainIfNeeded,
  deepEqual,
  loadCompiledModule,
  projectRoot,
  readJson,
  resolveOutputPath,
  runCases,
  writeJson,
} = require('./_shared.cjs');

async function main() {
  buildMainIfNeeded();

  const translationCore = loadCompiledModule('src/ts/libs/translationCore.js');
  const verify = loadCompiledModule('src/ts/rpgmv/verify.js');
  const corpusPath = path.join(projectRoot, 'test', 'fixtures', 'harness', 'eval-corpus.json');
  const corpus = readJson(corpusPath);

  const cases = [];

  for (const blockCase of corpus.blockCases) {
    cases.push({
      id: blockCase.id,
      title: blockCase.title,
      run: async () => {
        const originalBlocks = translationCore.splitIntoBlocks(blockCase.original);
        const validation = translationCore.validateChunk(originalBlocks, blockCase.candidate);
        const separatorOk = validation.blockValidations.every((item) => item.separatorMatch);
        const lineCountOk = validation.blockValidations.every((item) => item.lineCountMatch);
        const reassembled = translationCore.reassembleBlocks(originalBlocks);

        assert(reassembled === blockCase.original, `${blockCase.id}: source blocks no longer round-trip`);
        assert(separatorOk === blockCase.expected.separatorMatch, `${blockCase.id}: separator expectation failed`);
        assert(lineCountOk === blockCase.expected.lineCountMatch, `${blockCase.id}: line-count expectation failed`);

        return {
          category: 'block',
          separatorOk,
          lineCountOk,
          blockCount: originalBlocks.length,
        };
      },
    });
  }

  for (const verifyCase of corpus.verifyCases) {
    cases.push({
      id: verifyCase.id,
      title: verifyCase.title,
      run: async () => {
        const issues = verify.verifyJsonIntegrity(verifyCase.orig, verifyCase.trans);
        const types = issues.map((issue) => issue.type);
        for (const expectedType of verifyCase.expectedTypes) {
          assert(types.includes(expectedType), `${verifyCase.id}: missing expected issue type ${expectedType}`);
        }
        return {
          category: 'verify',
          issueTypes: types,
          issueCount: issues.length,
        };
      },
    });
  }

  for (const repairCase of corpus.repairCases) {
    cases.push({
      id: repairCase.id,
      title: repairCase.title,
      run: async () => {
        const repaired = verify.repairJson(repairCase.orig, repairCase.trans);
        assert(deepEqual(repaired, repairCase.expected), `${repairCase.id}: repaired output changed`);
        return {
          category: 'repair',
          repaired,
        };
      },
    });
  }

  const result = await runCases('harness-eval', cases);
  result.score = result.total === 0 ? 0 : Number(((result.passed / result.total) * 100).toFixed(2));

  const outputPath = resolveOutputPath('harness-eval');
  writeJson(outputPath, result);
  process.exitCode = result.failed === 0 ? 0 : 1;
}

main().catch((error) => {
  const outputPath = resolveOutputPath('harness-eval');
  writeJson(outputPath, {
    suite: 'harness-eval',
    status: 'failed',
    fatal: true,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
  process.exitCode = 1;
});
