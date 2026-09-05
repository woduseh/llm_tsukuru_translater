// Synthetic-provider benchmark of the production coordinator and Gemini factory.
// Only axios.post is replaced; file validation, cache/progress and atomic writes run normally.
// Baseline: node scripts/benchmark-translation.cjs --before-only --output <json>
// Compare: node scripts/benchmark-translation.cjs --baseline-dir <directory> --output <json>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const defaultBaselineDir = path.join(root, 'artifacts/performance/translation-2026-09-05/baseline');
const requestTotal = 8;
const model = 'gemini-flash-latest';
const chunkIds = Array.from({ length: requestTotal }, (_, index) => requestTotal - index);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshotPath = (directory, relative) => path.join(directory, `${relative}.source`);
const normalizedPath = value => value.replaceAll('\\', '/');

function parseArgs() {
  const options = { runs: 3, warmups: 1, baselineDir: defaultBaselineDir, beforeOnly: false };
  const names = { '--runs': 'runs', '--warmups': 'warmups', '--baseline-dir': 'baselineDir', '--output': 'output' };
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--before-only') { options.beforeOnly = true; continue; }
    const key = names[argument];
    const value = process.argv[++index];
    if (!key || !value || value.startsWith('--')) throw new Error(`Unknown or incomplete option: ${argument}`);
    options[key] = ['runs', 'warmups'].includes(key) ? Number(value) : path.resolve(value);
  }
  if (!Number.isSafeInteger(options.runs) || options.runs < 1) throw new Error('--runs must be a positive integer');
  if (!Number.isSafeInteger(options.warmups) || options.warmups < 0) throw new Error('--warmups must be a nonnegative integer');
  const required = ['src/ts/rpgmv/translator.ts', 'src/ts/libs/providerTranslationBase.ts',
    'src/ts/libs/providerRegistry.ts', 'src/ts/libs/geminiTranslator.ts'];
  for (const source of required) {
    if (!fs.existsSync(snapshotPath(options.baselineDir, source))) {
      throw new Error(`Missing baseline snapshot: ${snapshotPath(options.baselineDir, source)}`);
    }
  }
  return options;
}

async function loadRuntime(baselineDir) {
  const loadedSources = new Map();
  const overriddenSources = [];
  const result = await esbuild.build({
    absWorkingDir: root,
    stdin: { contents: [
      "export { translateFilesWithCoordinator, resolveLlmParallelWorkers, validateTranslatedFileContent, createTranslationBackup } from './src/ts/rpgmv/translator';",
      "export { settings as defaultSettings } from './src/ts/rpgmv/datas';",
      "export { default as axiosClient } from 'axios';",
    ].join('\n'), resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, metafile: true,
    plugins: [{ name: 'benchmark-source-snapshots', setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, args => {
        const relative = normalizedPath(path.relative(root, args.path));
        if (relative.startsWith('../') || path.isAbsolute(relative)) return;
        const snapshot = baselineDir && snapshotPath(baselineDir, relative);
        const sourcePath = snapshot && fs.existsSync(snapshot) ? snapshot : args.path;
        const contents = fs.readFileSync(sourcePath, 'utf8');
        loadedSources.set(relative, sha(contents));
        if (sourcePath === snapshot) overriddenSources.push(relative);
        const extension = path.extname(args.path).slice(1);
        const loader = extension === 'json' ? 'json' : extension === 'tsx' ? 'tsx'
          : extension === 'jsx' ? 'jsx' : extension.includes('ts') ? 'ts' : 'js';
        return { contents, loader, resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const filename = path.join(root, `benchmark-translation-${baselineDir ? 'before' : 'current'}-runtime.cjs`);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(root);
  loaded._compile(result.outputFiles[0].text, filename);
  const sources = Object.fromEntries(Object.keys(result.metafile.inputs).filter(value => value !== '<stdin>').sort().map(value => {
    const relative = normalizedPath(path.relative(root, path.resolve(root, value)));
    return [relative, loadedSources.get(relative) || sha(fs.readFileSync(path.resolve(root, value)))];
  }));
  return { api: loaded.exports, sources, bundleSha256: sha(result.outputFiles[0].text),
    overriddenSources: [...new Set(overriddenSources)].sort() };
}

function sourceBlock(id) {
  return [`--- ${id} ---`, `\\C[${id}]原文_${id}_話者\\C[0]`,
    `原文_${id}_本文 \\V[${id}]`, '', `原文_${id}_終端\\!`].join('\n');
}

function translatedText(source) {
  const words = { 話者: '화자', 本文: '본문', 終端: '끝' };
  return source.replace(/原文_(\d+)_(話者|本文|終端)/g, (_, id, word) => `번역_${id}_${words[word]}`);
}

function removeScratch(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('translation-benchmark-')) {
    throw new Error(`Unsafe benchmark cleanup target: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function makeFixture(api, fileCount) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-benchmark-'));
  try {
    const edir = path.join(scratch, 'Extract');
    fs.mkdirSync(edir);
    const blocksPerFile = requestTotal / fileCount;
    const files = Array.from({ length: fileCount }, (_, index) => {
      const ids = chunkIds.slice(index * blocksPerFile, (index + 1) * blocksPerFile);
      const name = `Map${String(index + 1).padStart(3, '0')}.txt`;
      const original = ids.map(sourceBlock).join('\n');
      const expected = translatedText(original);
      fs.writeFileSync(path.join(edir, name), original, 'utf8');
      return { name, ids, original, expected };
    });
    // Backup preparation precedes the measured production translation operation.
    const backupDir = await api.createTranslationBackup(edir);
    return { scratch, edir, backupDir, files };
  } catch (error) {
    removeScratch(scratch);
    throw error;
  }
}

function sourceFromBody(body) {
  const sourceMessages = (body?.contents || []).filter(item => item.role === 'user')
    .flatMap(item => item.parts || []).map(part => part.text).filter(value => typeof value === 'string');
  const matches = sourceMessages.map(value => value.match(/<Source_Text>\r?\n([\s\S]*?)\r?\n<\/Source_Text>/)).filter(Boolean);
  if (matches.length !== 1) throw new Error('Expected one wrapped Source_Text message from the production Gemini translator');
  return matches[0][1];
}

function installSyntheticProvider(axiosClient) {
  const originalPost = axiosClient.post;
  const requests = [];
  const pending = new Set();
  let active = 0;
  let activeMax = 0;
  let startedAt = 0;
  axiosClient.post = async function (url, body) {
    const source = sourceFromBody(body);
    const match = source.match(/^--- (\d+) ---\n/);
    if (!match) throw new Error('Synthetic provider received an unexpected chunk');
    const id = Number(match[1]);
    const delayMs = 120 + (id % 3) * 40;
    active++;
    activeMax = Math.max(activeMax, active);
    const request = { id, url, body, source, delayMs, startedMs: performance.now() - startedAt };
    requests.push(request);
    const delay = new Promise(resolve => setTimeout(resolve, delayMs));
    pending.add(delay);
    try {
      await delay;
      request.completedMs = performance.now() - startedAt;
      return { data: { candidates: [{ content: { role: 'model', parts: [{ text: translatedText(source) }] }, finishReason: 'STOP' }] } };
    } finally {
      active--;
      pending.delete(delay);
    }
  };
  return {
    requests,
    start(time) { startedAt = time; },
    state: () => ({ requestCount: requests.length, active, activeMax }),
    async restore() {
      // Drain any outstanding synthetic responses before the next runtime can use axios.
      await Promise.allSettled([...pending]);
      axiosClient.post = originalPost;
    },
  };
}

function verifySample(api, fixture, result, options, provider) {
  const expectedNames = fixture.files.map(file => file.name).sort();
  assert.deepEqual(result.failedFiles, [], 'Every file must finish successfully');
  assert.equal(result.workedFiles, fixture.files.length);
  assert.equal(result.totalErrors, 0);
  assert.equal(result.totalBlocks, requestTotal);
  assert.equal(result.entries.length, fixture.files.length);
  assert.deepEqual([...options.completedFiles].sort(), expectedNames);
  for (const entry of result.entries) {
    assert.equal(entry.cached, false);
    assert.equal(entry.errorBlocks, 0);
    assert.equal(entry.skippedBlocks, 0);
    assert.equal(entry.retries, 0);
    assert.equal(entry.translatedBlocks, requestTotal / fixture.files.length);
    assert.deepEqual(entry.errors, []);
  }
  const validation = fixture.files.map(file => {
    const output = fs.readFileSync(path.join(fixture.edir, file.name));
    assert.deepEqual(output, Buffer.from(file.expected, 'utf8'), `Translation bytes differ: ${file.name}`);
    assert.equal(fs.readFileSync(path.join(fixture.backupDir, file.name), 'utf8'), file.original);
    const checked = api.validateTranslatedFileContent(file.original, output.toString('utf8'));
    assert.deepEqual(checked, { ok: true, errors: [] }, `Invalid translated structure: ${file.name}`);
    return { file: file.name, bytes: output.length, sha256: sha(output), ...checked };
  });
  const progressBytes = fs.readFileSync(path.join(fixture.edir, '.llm_progress.json'));
  const cacheBytes = fs.readFileSync(path.join(fixture.edir, '.llm_cache.json'));
  const progress = JSON.parse(progressBytes.toString('utf8'));
  const cache = JSON.parse(cacheBytes.toString('utf8'));
  assert.deepEqual([...progress.completedFiles].sort(), expectedNames);
  assert.equal(typeof progress.fingerprint, 'string');
  assert.ok(progress.fingerprint.length > 0);
  assert.equal(Object.keys(cache.entries).length, fixture.files.length);
  assert.deepEqual(cache.entries, options.cache);
  assert.deepEqual(Object.values(cache.entries).map(entry => entry.translatedContent).sort(), fixture.files.map(file => file.expected).sort());
  assert.deepEqual(fs.readdirSync(fixture.edir).sort(), [...expectedNames, '.llm_cache.json', '.llm_progress.json'].sort(),
    'Atomic writes must leave only the final files');
  const state = provider.state();
  assert.equal(state.requestCount, requestTotal);
  assert.equal(state.active, 0);
  assert.ok(state.activeMax >= 1 && state.activeMax <= options.workerCount, 'Requests exceeded the resolved global cap');
  assert.deepEqual(provider.requests.map(request => request.id).sort((a, b) => a - b), [...chunkIds].sort((a, b) => a - b));
  const requests = provider.requests.map(request => {
    assert.equal(request.source, sourceBlock(request.id), 'Request payload changed the source workload');
    assert.equal(request.url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    const payload = JSON.stringify(request.body);
    const userMessages = request.body.contents.filter(item => item.role === 'user');
    assert.deepEqual(userMessages, [{ role: 'user', parts: [{ text: `<Source_Text>\n${request.source}\n</Source_Text>` }] }]);
    return { chunkId: request.id, sourceBytes: Buffer.byteLength(request.source), sourceSha256: sha(request.source),
      payloadBytes: Buffer.byteLength(payload), payloadSha256: sha(payload),
      userMessageSha256: sha(JSON.stringify(userMessages)),
      systemInstructionSha256: sha(JSON.stringify(request.body.system_instruction)),
      roles: request.body.contents.map(item => item.role),
      syntheticDelayMs: request.delayMs, startedMs: request.startedMs, completedMs: request.completedMs };
  });
  const sortedRequests = [...requests].sort((a, b) => a.chunkId - b.chunkId);
  const startedOrder = requests.map(request => request.chunkId);
  const completionOrder = [...requests].sort((a, b) => a.completedMs - b.completedMs).map(request => request.chunkId);
  return { ...state, requests, startedOrder, completionOrder,
    outOfOrderCompletion: JSON.stringify(startedOrder) !== JSON.stringify(completionOrder),
    outputBytes: validation.reduce((sum, file) => sum + file.bytes, 0),
    completedFiles: expectedNames, validation, cacheBytes: cacheBytes.length, progressBytes: progressBytes.length,
    digest: {
      source: sha(JSON.stringify(fixture.files.map(file => [file.name, file.original]))),
      translatedFiles: sha(JSON.stringify(validation.map(file => [file.file, file.sha256]))),
      requestWorkload: sha(JSON.stringify(sortedRequests.map(request => [request.chunkId, request.sourceSha256]))),
      userMessages: sha(JSON.stringify(sortedRequests.map(request => [request.chunkId, request.userMessageSha256]))),
      systemInstructions: sha(JSON.stringify(sortedRequests.map(request => [request.chunkId, request.systemInstructionSha256]))),
    },
    requestPayloadSha256: sha(JSON.stringify(sortedRequests.map(request => [request.chunkId, request.payloadSha256]))),
  };
}

async function runSample(runtime, fileCount, requestedWorkers, isBefore) {
  const api = runtime.api;
  const workerCount = api.resolveLlmParallelWorkers('gemini', requestedWorkers);
  assert.equal(workerCount, isBefore ? 1 : requestedWorkers, 'Unexpected production provider concurrency cap');
  const fixture = await makeFixture(api, fileCount);
  try {
    const options = {
      edir: fixture.edir, backupDir: fixture.backupDir, fileList: fixture.files.map(file => file.name),
      completedFiles: new Set(), cache: {}, provider: 'gemini', model, sourceLang: 'ja', targetLang: 'ko',
      settings: { ...api.defaultSettings, llmProvider: 'gemini', llmModel: model,
        llmApiKey: 'benchmark-synthetic-key', llmChunkSize: 1, llmTranslationUnit: 'chunk',
        llmParallelWorkers: requestedWorkers, llmRequestsPerMinute: 0,
        DoNotTransHangul: false, llmMaxRetries: 0, llmMaxApiRetries: 0 },
      translationMode: 'all', isResuming: false, workerCount, isAborted: () => false,
    };
    let progressEvents = 0;
    options.onProgress = () => { progressEvents++; };
    const provider = installSyntheticProvider(api.axiosClient);
    let result;
    let elapsedMs;
    let cpu;
    try {
      const startCpu = process.cpuUsage();
      const startedAt = performance.now();
      provider.start(startedAt);
      // Omit createTranslatorForFile: exercise the real registry/factory and Gemini request path.
      result = await api.translateFilesWithCoordinator(options);
      elapsedMs = performance.now() - startedAt;
      cpu = process.cpuUsage(startCpu);
    } finally {
      await provider.restore();
    }
    return { elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000, requestedWorkers, resolvedWorkers: workerCount, progressEvents,
      ...verifySample(api, fixture, result, options, provider) };
  } finally {
    removeScratch(fixture.scratch);
  }
}

function summary(samples) {
  const stats = key => {
    const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { median, min: values[0], max: values.at(-1) };
  };
  return Object.fromEntries(['elapsedMs', 'cpuMs', 'cpuUserMs', 'cpuSystemMs', 'requestCount', 'activeMax', 'progressEvents'].map(key => [key, stats(key)]));
}

function saveReport(report, output) {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const options = parseArgs();
  const runtimes = { before: await loadRuntime(options.baselineDir) };
  if (!options.beforeOnly) runtimes.current = await loadRuntime();
  if (runtimes.current) assert.equal(runtimes.before.api.axiosClient, runtimes.current.api.axiosClient, 'Runtime axios clients must share sequential instrumentation');
  const variants = [{ name: 'before', runtime: 'before', requestedWorkers: 8 }];
  if (!options.beforeOnly) {
    for (const requestedWorkers of [1, 2, 4, 8]) variants.push({ name: `current-${requestedWorkers}`, runtime: 'current', requestedWorkers });
  }
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), benchmark: 'production-translation-synthetic-provider',
    environment: { node: process.version, electron: process.versions.electron, platform: process.platform, arch: process.arch,
      osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    conditions: { ...options, model, requestsPerScenario: requestTotal, chunkSize: 1, translationUnit: 'chunk',
      llmRequestsPerMinute: 0, maxRetries: 0, maxApiRetries: 0,
      provider: 'Synthetic axios.post responses only; zero live network requests. This does not measure actual LLM quality or provider latency.',
      latency: '120 + (chunkId % 3) * 40 ms; source chunk IDs descend from 8 to 1 to permit out-of-order completion.',
      scope: 'Production translateFilesWithCoordinator -> real registry/factory -> GeminiTranslator, including structural validation, atomic translation/cache/progress writes and fsync.',
      excluded: 'Module build/load, fixture and backup preparation, post-run byte/structure/equality assertions, report generation and cleanup.',
      cache: 'Fresh files and empty translation cache per sample. OS filesystem cache is not flushed. Warmups are retained but excluded from summary statistics.',
      order: 'Forward/reverse variant order alternates every repetition; all samples and axios instrumentation run sequentially in one process.',
      payloadComparison: 'Source payloads must match byte-for-byte across variants. Full request-envelope hashes and equality are reported separately to expose intentional API-envelope changes.',
      before: 'Snapshot source with requested workers 8 resolved through production provider cap 1; original inter-chunk delay is retained.',
      current: 'Requested workers 1/2/4/8 are each resolved through the production provider cap. Requests must never exceed that global cap.',
    },
    sources: Object.fromEntries(Object.entries(runtimes).map(([name, runtime]) => [name, { files: runtime.sources,
      bundleSha256: runtime.bundleSha256, overriddenSources: runtime.overriddenSources }])), scenarios: [] };
  let expectedWorkloadDigest;
  for (const fileCount of [1, 4]) {
    const scenario = { name: fileCount === 1 ? 'one-file-eight-chunks' : 'four-files-two-chunks-each',
      files: fileCount, chunksPerFile: requestTotal / fileCount, totalChunks: requestTotal, variants: {}, executionOrder: [] };
    for (const variant of variants) scenario.variants[variant.name] = { warmups: [], samples: [] };
    let expectedDigest;
    const payloadDigests = new Set();
    for (let repetition = 0; repetition < options.warmups + options.runs; repetition++) {
      const warmup = repetition < options.warmups;
      const run = warmup ? repetition + 1 : repetition - options.warmups + 1;
      const order = repetition % 2 ? [...variants].reverse() : [...variants];
      scenario.executionOrder.push({ phase: warmup ? 'warmup' : 'measured', run, variants: order.map(variant => variant.name) });
      for (const variant of order) {
        const sample = await runSample(runtimes[variant.runtime], fileCount, variant.requestedWorkers, variant.runtime === 'before');
        if (expectedDigest) assert.deepEqual(sample.digest, expectedDigest, 'Variants must use identical source text and produce identical translation bytes');
        expectedDigest = sample.digest;
        if (expectedWorkloadDigest) assert.equal(sample.digest.requestWorkload, expectedWorkloadDigest, 'Both scenarios must send the same eight source chunks');
        expectedWorkloadDigest = sample.digest.requestWorkload;
        payloadDigests.add(sample.requestPayloadSha256);
        scenario.variants[variant.name][warmup ? 'warmups' : 'samples'].push(sample);
        console.log(`${scenario.name} ${variant.name} ${warmup ? 'warmup' : 'run'} ${run}: ${sample.elapsedMs.toFixed(1)} ms; CPU ${sample.cpuMs.toFixed(1)} ms; requests ${sample.requestCount}; active max ${sample.activeMax}/${sample.resolvedWorkers}`);
      }
    }
    for (const variant of Object.values(scenario.variants)) variant.summary = summary(variant.samples);
    scenario.identicalTranslationBytes = true;
    scenario.identicalRequestWorkload = true;
    scenario.identicalFullRequestPayloads = payloadDigests.size === 1;
    report.scenarios.push(scenario);
    saveReport(report, options.output);
  }
  report.identicalRequestWorkloadAcrossScenarios = true;
  saveReport(report, options.output);
  if (options.output) console.log(`Report: ${options.output}`);
  else console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
