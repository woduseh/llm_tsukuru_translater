// Real production Wolf extraction/apply on generated, parseable maps. No providers.
// Capture before editing: node scripts/benchmark-wolf.cjs --capture-baseline <directory> --output <json>
// Compare: node scripts/benchmark-wolf.cjs --baseline-dir <directory> --output <json>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const changedSources = ['src/ts/wolf/extract/makeText.ts', 'src/ts/wolf/apply/applyWolf.ts'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// The main tsconfig includes repository-wide *.ts inputs, including artifacts.
const snapshotPath = (directory, source) => path.join(directory, `${source}.source`);

function parseArgs() {
  const options = { counts: [1000, 5000], maps: 10, runs: 5, warmups: 1 };
  const names = { '--counts': 'counts', '--maps': 'maps', '--runs': 'runs', '--warmups': 'warmups',
    '--baseline-dir': 'baselineDir', '--capture-baseline': 'captureBaseline', '--output': 'output' };
  for (let i = 2; i < process.argv.length; i++) {
    const key = names[process.argv[i]];
    const value = process.argv[++i];
    if (!key || !value || value.startsWith('--')) throw new Error('Unknown or incomplete benchmark option');
    options[key] = key === 'counts' ? value.split(',').map(Number)
      : ['maps', 'runs', 'warmups'].includes(key) ? Number(value) : path.resolve(value);
  }
  for (const value of [...options.counts, options.maps, options.runs, options.warmups]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Counts, maps, runs and warmups must be positive integers');
  }
  if (options.captureBaseline && options.baselineDir) throw new Error('Capture and comparison are separate commands');
  return options;
}

async function loadRuntime(baselineDir) {
  const result = await esbuild.build({
    stdin: { contents: [
      "export { default as makeText } from './src/ts/wolf/extract/makeText';",
      "export { extractWolfFolder } from './src/ts/wolf/extract/extractor';",
      "export { wolfAppyier } from './src/ts/wolf/apply/applyWolf';",
      "export { default as metadata } from './src/ts/wolf/extract/wolfExtData';",
      "export { default as tools } from './src/ts/libs/projectTools';",
      "export { AppContext } from './src/appContext';",
      "export { makeWolfMap, wolfDialogue } from './test/utils/wolfMapFixture';",
    ].join('\n'), resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, metafile: true,
    plugins: baselineDir ? [{ name: 'before-edit-sources', setup(build) {
      build.onLoad({ filter: /\.(ts)$/ }, args => {
        const relative = path.relative(root, args.path).replaceAll('\\', '/');
        if (changedSources.includes(relative)) return {
          contents: fs.readFileSync(snapshotPath(baselineDir, relative), 'utf8'), loader: 'ts',
          resolveDir: path.dirname(args.path),
        };
      });
    } }] : [],
  });
  const loaded = new Module(path.join(root, 'benchmark-wolf-runtime.cjs'), module);
  loaded.filename = path.join(root, 'benchmark-wolf-runtime.cjs');
  loaded.paths = Module._nodeModulePaths(root);
  loaded._compile(result.outputFiles[0].text, loaded.filename);
  const sources = Object.fromEntries(Object.keys(result.metafile.inputs).filter(p => p !== '<stdin>').sort().map(p => {
    const relative = p.replaceAll('\\', '/');
    const file = baselineDir && changedSources.includes(relative) ? snapshotPath(baselineDir, relative) : path.resolve(root, p);
    return [relative, sha(fs.readFileSync(file))];
  }));
  return { api: loaded.exports, sources };
}

function removeScratch(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wolf-benchmark-')) {
    throw new Error(`Unsafe benchmark cleanup target: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function makeFixture(api, count, mapCount) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf-benchmark-'));
  const paths = { projectRoot, dataDir: path.join(projectRoot, 'Data'), extractRoot: path.join(projectRoot, '_Extract') };
  const maps = [];
  fs.mkdirSync(paths.dataDir);
  const expectedLines = [];
  const translatedLines = [];
  for (let mapIndex = 0; mapIndex < Math.min(mapCount, count); mapIndex++) {
    const first = Math.floor(mapIndex * count / Math.min(mapCount, count));
    const end = Math.floor((mapIndex + 1) * count / Math.min(mapCount, count));
    const originals = Array.from({ length: end - first }, (_, i) => api.wolfDialogue(first + i));
    const translations = originals.map((_, i) => api.wolfDialogue(first + i, true));
    const original = api.makeWolfMap(originals);
    const expected = api.makeWolfMap(translations);
    const name = `Map${String(mapIndex).padStart(5, '0')}.mps`;
    fs.writeFileSync(path.join(paths.dataDir, name), original);
    maps.push({ name, original, expected });
    for (const [input, output] of [[originals, expectedLines], [translations, translatedLines]]) {
      for (const value of input) output.push('--- 101-0 ---', ...value.replace(/\0$/, '').replaceAll('\\', '\\\\').split('\n'));
    }
  }
  return { paths, maps, expectedText: expectedLines.join('\n'), translatedText: translatedLines.join('\n') };
}

async function measure(operation, eventCounter) {
  const fsCalls = {};
  const originals = {};
  const names = ['realpathSync', 'existsSync', 'lstatSync', 'readFileSync', 'writeFileSync', 'fsyncSync', 'renameSync'];
  for (const name of names) {
    originals[name] = fs[name];
    fsCalls[name] = 0;
    fs[name] = function (...args) { fsCalls[name]++; return originals[name].apply(this, args); };
  }
  const originalTimeout = global.setTimeout;
  let timerCount = 0;
  global.setTimeout = function (...args) { timerCount++; return originalTimeout(...args); };
  let lastBeat = performance.now();
  let maxHeartbeatGapMs = 0;
  let heartbeats = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastBeat);
    lastBeat = now;
    heartbeats++;
  }, 5);
  eventCounter.count = 0;
  const startCpu = process.cpuUsage();
  const start = performance.now();
  try {
    await operation();
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(startCpu);
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, performance.now() - lastBeat);
    return { elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, progressEvents: eventCounter.count,
      timerCount, fsCalls, heartbeats, maxHeartbeatGapMs };
  } finally {
    clearInterval(heartbeat);
    global.setTimeout = originalTimeout;
    for (const name of names) fs[name] = originals[name];
  }
}

async function runSample(api, count, maps) {
  const fixture = makeFixture(api, count, maps);
  const counter = { count: 0 };
  const ctx = new api.AppContext();
  ctx.mainWindow = { webContents: { send(channel) { if (channel === 'loading') counter.count++; } } };
  api.tools.init(ctx);
  try {
    const extract = await measure(async () => {
      await api.extractWolfFolder(fixture.paths.dataDir, {}, ctx, fixture.paths.projectRoot);
      await api.makeText(ctx, fixture.paths.extractRoot);
    }, counter);
    assert.equal(ctx.WolfExtData.length, count);
    const textPath = path.join(fixture.paths.extractRoot, 'Texts', 'map.txt');
    assert.equal(fs.readFileSync(textPath, 'utf8'), fixture.expectedText);
    const metadataPath = path.join(fixture.paths.extractRoot, '.extracteddata');
    const restored = new api.AppContext();
    api.metadata.read(metadataPath, restored);
    assert.deepEqual(restored.WolfExtData, ctx.WolfExtData);
    assert.deepEqual(restored.WolfCache, ctx.WolfCache);
    const metadataSha = sha(fs.readFileSync(metadataPath));
    fs.writeFileSync(textPath, fixture.translatedText);
    const apply = await measure(() => api.wolfAppyier(ctx, fixture.paths), counter);
    for (const item of fixture.maps) assert.deepEqual(fs.readFileSync(path.join(fixture.paths.dataDir, item.name)), item.expected);
    assert.equal(fs.readdirSync(fixture.paths.dataDir).some(name => name.includes('.wolf-apply-')), false);
    return { extract, apply, digest: { source: sha(Buffer.concat(fixture.maps.map(m => m.original))),
      extractedText: sha(fixture.expectedText), metadata: metadataSha,
      appliedMaps: sha(Buffer.concat(fixture.maps.map(m => m.expected))) } };
  } finally { removeScratch(fixture.paths.projectRoot); }
}

function summary(samples) {
  const stats = key => {
    const values = samples.map(s => s[key]).sort((a, b) => a - b);
    const median = values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
    return { median, min: values[0], max: values.at(-1) };
  };
  return Object.fromEntries(['elapsedMs', 'cpuMs', 'progressEvents', 'timerCount', 'maxHeartbeatGapMs'].map(key => [key, stats(key)]));
}

async function main() {
  const options = parseArgs();
  if (options.captureBaseline) {
    for (const source of changedSources) {
      const target = snapshotPath(options.captureBaseline, source);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, source), target, fs.constants.COPYFILE_EXCL);
    }
  }
  const variants = {};
  if (options.baselineDir) variants.before = await loadRuntime(options.baselineDir);
  variants.current = await loadRuntime();
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), environment: {
    node: process.version, electron: process.versions.electron, platform: process.platform, arch: process.arch,
    osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
  }, conditions: { ...options, data: 'generated parseable Wolf v3 maps with multiline/empty/null/control-code dialogue',
    cache: 'Fresh fixture per sample; OS filesystem cache is NOT flushed. Warmup runs excluded from summaries.',
    order: 'Variants alternate AB/BA each repetition; all operations execute serially in one process.',
    scope: 'extractWolfFolder + makeText, and complete wolfAppyier including validation, staging, fsync and commit; fixture creation and equality assertions excluded',
    ipc: 'Production progress calls counted; Electron IPC transport/rendering is not included.',
    eventLoop: '5ms heartbeat gaps include timers and synchronous stages; not a browser frame-time metric.',
  }, sources: Object.fromEntries(Object.entries(variants).map(([name, v]) => [name, v.sources])), scenarios: [] };
  for (const count of options.counts) {
    const scenario = { strings: count, maps: Math.min(options.maps, count), variants: {} };
    let expectedDigest;
    for (const name of Object.keys(variants)) scenario.variants[name] = { warmups: [], samples: [] };
    for (let run = -options.warmups; run < options.runs; run++) {
      const order = Object.keys(variants);
      if (Math.abs(run) % 2) order.reverse();
      for (const name of order) {
        const sample = await runSample(variants[name].api, count, options.maps);
        if (expectedDigest) assert.deepEqual(sample.digest, expectedDigest);
        expectedDigest = sample.digest;
        scenario.variants[name][run < 0 ? 'warmups' : 'samples'].push(sample);
        console.log(`${count} strings ${name} ${run < 0 ? 'warmup' : `run ${run + 1}`}: extract ${sample.extract.elapsedMs.toFixed(1)} ms, apply ${sample.apply.elapsedMs.toFixed(1)} ms`);
      }
    }
    for (const variant of Object.values(scenario.variants)) variant.summary = {
      extract: summary(variant.samples.map(s => s.extract)), apply: summary(variant.samples.map(s => s.apply)),
    };
    scenario.identicalOutputs = true;
    report.scenarios.push(scenario);
    if (options.output) { fs.mkdirSync(path.dirname(options.output), { recursive: true }); fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n'); }
  }
  if (!options.output) console.log(JSON.stringify(report, null, 2));
  else console.log(`Report: ${options.output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
