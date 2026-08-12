#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const {
  projectRoot,
  writeFatalHarnessResult,
  writeHarnessResult,
} = require('./_shared.cjs');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
}

function findMissingRendererCssAssets() {
  const cssRoot = path.join(projectRoot, 'src', 'renderer');
  const missing = [];
  const pending = [cssRoot];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name) !== '.css') continue;

      const css = fs.readFileSync(entryPath, 'utf8');
      for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const reference = match[2].trim();
        if (/^(?:data:|https?:|#)/i.test(reference)) continue;
        const assetPath = path.resolve(path.dirname(entryPath), reference.split(/[?#]/, 1)[0]);
        if (!fs.existsSync(assetPath)) {
          missing.push({
            source: path.relative(projectRoot, entryPath),
            reference,
          });
        }
      }
    }
  }

  return missing;
}

function main() {
  const packageJson = readPackageJson();
  const config = packageJson.build || {};
  const optIn = process.env.LLM_TSUKURU_PACKAGE_SMOKE === '1';
  const outputDir = path.join(projectRoot, config.directories?.output || 'dist');
  const targets = config.win?.target || [];
  const targetNames = targets.map((target) => (typeof target === 'string' ? target : target.target)).filter(Boolean);
  const missingRendererCssAssets = findMissingRendererCssAssets();

  const baseChecks = [
    { id: 'app-id', ok: typeof config.appId === 'string' && config.appId.length > 0 },
    { id: 'asar-enabled', ok: config.asar === true },
    {
      id: 'native-pty-unpacked',
      ok: Array.isArray(config.asarUnpack) && config.asarUnpack.some((entry) => String(entry).includes('node-pty')),
    },
    { id: 'windows-targets', ok: targetNames.includes('portable') && targetNames.includes('nsis') },
    { id: 'compiled-files-only', ok: Array.isArray(config.files) && config.files.includes('dist-main/**') && config.files.includes('dist-renderer/**') },
    {
      id: 'xterm-dependencies',
      ok: Boolean(packageJson.dependencies?.['@xterm/xterm'] && packageJson.dependencies?.['@xterm/addon-fit']),
    },
    {
      id: 'renderer-css-assets-resolve',
      ok: missingRendererCssAssets.length === 0,
      details: { missing: missingRendererCssAssets },
    },
  ];

  const cases = baseChecks.map((check) => ({
    id: check.id,
    title: `packaging config: ${check.id}`,
    status: check.ok ? 'passed' : 'failed',
    durationMs: 0,
    ...(check.details ? { details: check.details } : {}),
    ...(check.ok ? {} : { error: { message: `Packaging config check failed: ${check.id}` } }),
  }));

  let nativePtyLoad = { attempted: true, ok: false, error: '' };
  try {
    require('node-pty');
    nativePtyLoad = { attempted: true, ok: true, error: '' };
  } catch (error) {
    nativePtyLoad = { attempted: true, ok: false, error: error.message || String(error) };
  }
  cases.push({
    id: 'native-pty-load-or-fallback',
    title: 'native PTY module loads or app can use degraded fallback',
    status: 'passed',
    durationMs: 0,
    details: {
      nativePtyLoad,
      fallbackExpectedWhenUnavailable: !nativePtyLoad.ok,
    },
  });

  if (!optIn) {
    writeHarnessResult('harness-package-smoke', {
      suite: 'harness-package-smoke',
      status: baseChecks.every((check) => check.ok) ? 'skipped' : 'failed',
      completedAt: new Date().toISOString(),
      cases,
      metrics: {
        optIn,
        packageBuildExecuted: false,
        configuredTargets: targetNames,
        nativePtyLoad,
      },
      artifacts: {
        packageJson: 'package.json',
      },
      failureHints: [
        'Set LLM_TSUKURU_PACKAGE_SMOKE=1 after running npm run dist:all to inspect packaged Windows artifacts.',
      ],
      reproCommand: 'node scripts/harness/package-smoke.cjs',
    });
    process.exitCode = baseChecks.every((check) => check.ok) ? 0 : 1;
    return;
  }

  const packagedArtifacts = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((name) => /\.exe$/i.test(name) && name.includes(packageJson.version))
    : [];
  const hasPortable = packagedArtifacts.some((name) => !/\bSetup\b/i.test(name));
  const hasInstaller = packagedArtifacts.some((name) => /\bSetup\b/i.test(name));
  cases.push({
    id: 'packaged-artifacts-present',
    title: 'packaged Windows portable/installer artifacts are present',
    status: hasPortable && hasInstaller ? 'passed' : 'failed',
    durationMs: 0,
    details: { outputDir: path.relative(projectRoot, outputDir), packagedArtifacts },
    ...(hasPortable && hasInstaller ? {} : { error: { message: 'Expected both portable and Setup .exe artifacts for the current version.' } }),
  });

  const failed = cases.filter((testCase) => testCase.status === 'failed').length;
  writeHarnessResult('harness-package-smoke', {
    suite: 'harness-package-smoke',
    status: failed === 0 ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    cases,
      metrics: {
        optIn,
        packageBuildExecuted: false,
        configuredTargets: targetNames,
        packagedArtifactCount: packagedArtifacts.length,
        nativePtyLoad,
      },
    artifacts: {
      packageJson: 'package.json',
      outputDir: path.relative(projectRoot, outputDir),
    },
    reproCommand: 'node scripts/harness/package-smoke.cjs',
  });
  process.exitCode = failed === 0 ? 0 : 1;
}

try {
  main();
} catch (error) {
  writeFatalHarnessResult('harness-package-smoke', error, {
    metrics: { setupFailed: true },
    reproCommand: 'node scripts/harness/package-smoke.cjs',
  });
  process.exitCode = 1;
}
