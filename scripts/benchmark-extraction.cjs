// Synthetic parser benchmark; no game files or providers are accessed.
// node scripts/benchmark-extraction.cjs [--baseline-ref HEAD]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const parserPath = 'src/ts/rpgmv/extract/parser.ts';
function loadParser(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('exports', outputText)(exports);
  return exports.extract;
}
async function measure(extract, source) {
  const times = [];
  let digest;
  for (let run = 0; run < 4; run++) {
    const context = { gb: {}, settings: { ExtractAddLine: false } };
    const start = performance.now();
    const result = await extract(source, { fileName: 'Actors.json', note: false }, 'actor', context);
    const elapsed = performance.now() - start;
    if (run > 0) times.push(elapsed);
    digest = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  }
  times.sort((a, b) => a - b);
  return { medianMs: Number(times[1].toFixed(2)), digest };
}
async function main() {
  const current = loadParser(fs.readFileSync(path.join(root, parserPath), 'utf8'));
  const baselineFlag = process.argv.indexOf('--baseline-ref');
  const baselineRef = baselineFlag >= 0 ? process.argv[baselineFlag + 1] : undefined;
  if (baselineFlag >= 0 && !baselineRef) throw new Error('--baseline-ref requires a git ref');
  const baseline = baselineRef ? loadParser(execFileSync('git', ['show', `${baselineRef}:${parserPath}`], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  })) : null;
  const results = [];
  for (const actors of [500, 2000, 4000]) {
    const source = JSON.stringify([null, ...Array.from({ length: actors }, (_, i) => ({
      name: `Actor ${i}`, nickname: '', profile: `First \\V[1]\n\nLast ${i}`,
    }))]);
    const before = baseline ? await measure(baseline, source) : null;
    const after = await measure(current, source);
    if (before && before.digest !== after.digest) throw new Error(`Output mismatch at ${actors} actors`);
    const row = { actors, baselineMs: before?.medianMs, currentMs: after.medianMs,
      identicalOutput: before ? true : undefined };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  console.log(JSON.stringify({ node: process.version, baselineRef, runs: 3, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
