#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  assert,
  buildMainIfNeeded,
  defaultExport,
  loadCompiledModule,
  makeTempDir,
  npmCommand,
  projectRoot,
  runCases,
  runCommand,
  writeFatalHarnessResult,
  writeHarnessResult,
  writeTaskManifest,
} = require('./_shared.cjs');

function buildSuccessValidation(blocks) {
  return blocks.map((block, index) => ({
    index,
    separator: block.separator,
    originalLines: block.lines,
    translatedLines: block.lines,
    lineCountMatch: true,
    separatorMatch: true,
  }));
}

async function runBundledMcpConversation(projectDir, timeoutMs = 10000) {
  const bundlePath = path.join(projectRoot, 'res', 'mcp-agent-server.cjs');
  const child = spawn(process.execPath, [bundlePath, '--project', projectDir], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdoutBuffer = '';
  let stderr = '';
  let exited = false;
  const pending = new Map();
  const unmatchedResponses = [];

  const rejectPending = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    while (stdoutBuffer.includes('\n')) {
      const newlineIndex = stdoutBuffer.indexOf('\n');
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        rejectPending(new Error(`MCP server emitted invalid JSON: ${line.slice(0, 300)}`));
        continue;
      }
      const waiter = pending.get(String(response.id));
      if (waiter) {
        pending.delete(String(response.id));
        waiter.resolve(response);
      } else {
        unmatchedResponses.push(response);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });
  child.on('error', rejectPending);
  child.on('exit', (code, signal) => {
    exited = true;
    if (pending.size > 0) {
      rejectPending(new Error(`MCP server exited early with code=${code} signal=${signal}; stderr=${stderr}`));
    }
  });

  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`Timed out waiting for MCP ${method}; stderr=${stderr}`));
    }, timeoutMs);
    pending.set(String(id), {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const stop = async () => {
    if (!child.stdin.destroyed) child.stdin.end();
    if (exited) return;
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (!exited) child.kill();
  };

  try {
    child.stdin.write('not-json\n');
    const initialized = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'harness-core', version: '1' },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await request(2, 'tools/list');
    const called = await request(3, 'tools/call', {
      name: 'project.context_snapshot',
      arguments: {},
    });
    return { initialized, listed, called, stderr, unmatchedResponses };
  } finally {
    await stop();
  }
}

async function runBundledMcpStartupFailure(projectPath, timeoutMs = 5000) {
  const bundlePath = path.join(projectRoot, 'res', 'mcp-agent-server.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundlePath, '--project', projectPath], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Invalid project MCP process did not exit; stderr=${stderr}`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function main() {
  buildMainIfNeeded();

  const translationCore = loadCompiledModule('src/ts/libs/translationCore.js');
  const llmProviderConfig = loadCompiledModule('src/ts/libs/llmProviderConfig.js');
  const translatorFactory = loadCompiledModule('src/ts/libs/translatorFactory.js');
  const verify = loadCompiledModule('src/ts/rpgmv/verify.js');
  const translatorModule = loadCompiledModule('src/ts/rpgmv/translator.js');
  const projectTools = defaultExport(loadCompiledModule('src/ts/libs/projectTools.js'));

  const cases = [
    {
      id: 'docs-entrypoints',
      title: 'agent and harness docs exist',
      run: async () => {
        const requiredDocs = [
          'AGENTS.md',
          'docs/ARCHITECTURE.md',
          'docs/QUALITY_RULES.md',
          'docs/HARNESS.md',
          'docs/exec-plans/active/harness-engineering.md',
        ];
        for (const docPath of requiredDocs) {
          assert(fs.existsSync(path.join(projectRoot, docPath)), `missing ${docPath}`);
        }
        return { requiredDocs };
      },
    },
    {
      id: 'bundled-mcp-stdio',
      title: 'bundled MCP server completes a real stdio handshake and tool call',
      run: async () => {
        runCommand(npmCommand(), ['run', 'build:mcp']);
        const workspace = makeTempDir('llm-tsukuru-mcp-bundle-');
        try {
          const response = await runBundledMcpConversation(workspace);
          assert(response.initialized.result?.protocolVersion === '2025-06-18', 'MCP protocol negotiation changed');
          assert(response.unmatchedResponses.some((item) => item.error?.code === -32700), 'malformed JSON did not return a parse error');
          const tools = response.listed.result?.tools;
          assert(Array.isArray(tools) && tools.length > 0, 'MCP tool list is empty');
          assert(!tools.some((tool) => ['settings.get_sanitized', 'provider.readiness', 'harness.latest'].includes(tool.name)), 'offline-only exclusions changed');
          assert(tools.every((tool) => typeof tool.annotations?.readOnlyHint === 'boolean'), 'MCP readOnlyHint annotations are missing');
          assert(response.called.result?.isError === false, 'project.context_snapshot failed');
          const text = response.called.result?.content?.[0]?.text;
          const payload = JSON.parse(text);
          assert(payload.projectRoot === workspace, 'context snapshot returned the wrong project root');
          assert(fs.readdirSync(workspace).length === 0, 'readonly server startup or context call wrote into the project');
          const missingProject = path.join(workspace, 'missing-project');
          const startupFailure = await runBundledMcpStartupFailure(missingProject);
          assert(startupFailure.code !== 0, 'missing --project path should fail startup');
          assert(!fs.existsSync(missingProject), 'missing --project path was created');
          return {
            protocolVersion: response.initialized.result.protocolVersion,
            toolCount: tools.length,
            contextProjectRoot: payload.projectRoot,
          };
        } finally {
          fs.rmSync(workspace, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'translation-core-invariants',
      title: 'split, reassemble, and validate chunk invariants hold',
      run: async () => {
        const original = '머리말\n--- 101 ---\nこんにちは\n\\V[1]\n--- 102 ---\nさようなら';
        const translated = '머리말\n--- 101 ---\n안녕하세요\n\\V[1]\n--- 102 ---\n안녕히 가세요';
        const blocks = translationCore.splitIntoBlocks(original);
        const reassembled = translationCore.reassembleBlocks(blocks);
        const validation = translationCore.validateChunk(blocks, translated);

        assert(reassembled === original, 'reassembled blocks did not round-trip');
        assert(validation.blockValidations.every((item) => item.lineCountMatch), 'line counts drifted');
        assert(validation.blockValidations.every((item) => item.separatorMatch), 'separator drift detected');

        return {
          blockCount: blocks.length,
          validationCount: validation.blockValidations.length,
        };
      },
    },
    {
      id: 'llm-readiness-and-cache-key',
      title: 'LLM readiness and cache key semantics stay deterministic',
      run: async () => {
        const readyGemini = translatorFactory.getLlmReadinessError({
          llmProvider: 'gemini',
          llmApiKey: 'test-key',
          llmModel: 'gemini-harness',
        });
        const missingGemini = translatorFactory.getLlmReadinessError({
          llmProvider: 'gemini',
          llmApiKey: '',
          llmModel: 'gemini-harness',
        });
        const readyVertex = llmProviderConfig.validateLlmSettings({
          llmProvider: 'vertex',
          llmApiKey: '',
          llmModel: 'gemini-harness',
          llmVertexLocation: '',
          llmVertexServiceAccountJson: JSON.stringify({
            client_email: 'vertex@test-project.iam.gserviceaccount.com',
            private_key: 'private-key',
            project_id: 'vertex-project',
          }),
        });
        const cacheKey = translatorFactory.buildTranslationCacheKey('vertex', 'abc123', 'gemini-harness', 'ko');

        assert(readyGemini === null, 'ready gemini settings should not fail');
        assert(typeof missingGemini === 'string' && missingGemini.includes('Gemini'), 'missing gemini error changed');
        assert(readyVertex.llmReady, 'vertex settings should validate');
        assert(cacheKey === 'vertex_abc123_gemini-harness_ko', 'cache key format changed');

        return {
          missingGemini,
          cacheKey,
          vertexLocation: readyVertex.llmVertexLocation,
        };
      },
    },
    {
      id: 'verify-and-repair-invariants',
      title: 'verifyJsonIntegrity and repairJson preserve structural rules',
      run: async () => {
        const orig = {
          displayName: '東の洞窟',
          event: { code: 401, indent: 0, parameters: ['--- 101 ---'] },
        };
        const trans = {
          displayName: '동쪽 동굴',
          event: { code: 401, indent: 0, parameters: ['밀려온 대사'] },
        };
        const issues = verify.verifyJsonIntegrity(orig, trans);
        const repaired = verify.repairJson(orig, trans);

        assert(issues.some((issue) => issue.type === 'text_shift'), 'text_shift issue disappeared');
        assert(repaired.displayName === '동쪽 동굴', 'displayName should stay translated');
        assert(repaired.event.parameters[0] === '--- 101 ---', 'marker repair changed');

        return {
          issueTypes: issues.map((issue) => issue.type),
          repairedDisplayName: repaired.displayName,
        };
      },
    },
    {
      id: 'bulk-translation-workflow',
      title: 'bulk translation workflow preserves backup, cache, and untranslated-only semantics',
      category: 'mock-provider',
      run: async () => {
        const workspace = makeTempDir('llm-tsukuru-core-');
        const extractDir = path.join(workspace, 'Extract');
        const fileOne = path.join(extractDir, 'Map001.txt');
        const fileTwo = path.join(extractDir, 'Map002.txt');
        fs.mkdirSync(extractDir, { recursive: true });
        fs.writeFileSync(fileOne, '--- 101 ---\nこんにちは', 'utf8');
        fs.writeFileSync(fileTwo, '--- 101 ---\nさようなら', 'utf8');

        const emitted = [];
        const ctx = {
          settings: {
            llmProvider: 'gemini',
            llmApiKey: 'stub-key',
            llmModel: 'gemini-harness',
            llmTargetLang: 'ko',
            llmSourceLang: 'ja',
          },
          llmAbort: false,
          mainWindow: {
            webContents: {
              send: (channel, ...args) => emitted.push({ channel, args }),
            },
          },
        };

        projectTools.init(ctx);

        const originalCreateTranslator = translatorFactory.createTranslator;
        const originalReadinessError = translatorFactory.getLlmReadinessError;

        let translateCalls = 0;
        const translateText = (text) => text
          .replace('こんにちは', '안녕하세요')
          .replace('さようなら', '안녕히 가세요');

        translatorFactory.getLlmReadinessError = () => null;
        translatorFactory.createTranslator = () => ({
          async translateText(text) {
            return translateText(text);
          },
          async translateFileContent(content, onProgress) {
            translateCalls += 1;
            const blocks = translationCore.splitIntoBlocks(content);
            onProgress?.(blocks.length, blocks.length, 'stub');
            return {
              translatedContent: translateText(content),
              validation: buildSuccessValidation(blocks),
              logEntry: {
                totalBlocks: blocks.length,
                translatedBlocks: blocks.length,
                skippedBlocks: 0,
                errorBlocks: 0,
                retries: 0,
                durationMs: 1,
                errors: [],
              },
              aborted: false,
            };
          },
        });

        try {
          const arg = {
            dir: Buffer.from(workspace, 'utf8').toString('base64'),
            game: 'mvmz',
            sortOrder: 'name-asc',
            translationMode: 'untranslated',
          };

          await translatorModule.trans(null, arg, ctx);
          const firstRunCalls = translateCalls;

          translateCalls = 0;
          await translatorModule.trans(null, arg, ctx);
          const secondRunCalls = translateCalls;

          const backupFileOne = path.join(workspace, 'Extract_backup', 'Map001.txt');
          fs.copyFileSync(backupFileOne, fileOne);

          translateCalls = 0;
          await translatorModule.trans(null, { ...arg, resetProgress: true }, ctx);
          const resetRunCalls = translateCalls;

          const cachePath = path.join(extractDir, '.llm_cache.json');
          const progressPath = path.join(extractDir, '.llm_progress.json');
          const logFiles = fs.readdirSync(extractDir).filter((file) => file.startsWith('translation_log_'));

          assert(fs.existsSync(path.join(workspace, 'Extract_backup')), 'backup directory missing');
          assert(fs.existsSync(cachePath), 'cache file missing');
          assert(!fs.existsSync(progressPath), 'progress file should be cleared');
          assert(logFiles.length >= 1, 'translation log not written');
          assert(fs.readFileSync(fileOne, 'utf8').includes('안녕하세요'), 'first file was not translated');
          assert(fs.readFileSync(fileTwo, 'utf8').includes('안녕히 가세요'), 'second file was not translated');
          assert(firstRunCalls === 2, `expected 2 translations on first run, got ${firstRunCalls}`);
          assert(secondRunCalls === 0, `expected untranslated-only second run to skip all files, got ${secondRunCalls}`);
          assert(resetRunCalls === 1, `expected reset untranslated-only run to retranslate one file, got ${resetRunCalls}`);
          assert(emitted.some((event) => event.channel === 'loadingTag'), 'loading progress events disappeared');

          return {
            firstRunCalls,
            secondRunCalls,
            resetRunCalls,
            logFiles,
          };
        } finally {
          translatorFactory.createTranslator = originalCreateTranslator;
          translatorFactory.getLlmReadinessError = originalReadinessError;
        }
      },
    },
  ];

  const taskManifest = writeTaskManifest('harness-core', cases, {
    deterministic: true,
    liveProviderRequired: false,
    mockProvider: {
      id: 'deterministic-string-replacer',
      purpose: 'Exercises bulk translation without external LLM credentials.',
    },
  });
  const result = await runCases('harness-core', cases);
  result.metrics = {
    caseCount: result.total,
    failedCases: result.failed,
    deterministicMockProvider: 'deterministic-string-replacer',
  };
  result.artifacts = { taskManifest };
  writeHarnessResult('harness-core', result);
  process.exitCode = result.failed === 0 ? 0 : 1;
}

main().catch((error) => {
  writeFatalHarnessResult('harness-core', error, {
    metrics: {
      setupFailed: true,
    },
  });
  process.exitCode = 1;
});
