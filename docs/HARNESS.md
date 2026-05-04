# Harness

## Goals

The harness stack exists to make the repository self-checking for both humans and coding agents.

- `harness:core`: deterministic checks against compiled main-process modules and translation workflow semantics
- `harness:eval`: curated fixture corpus scored by structural and repair metrics
- `harness:ui`: Electron smoke harness that opens real windows and inspects stable UI state
- `harness:live`: optional real-provider smoke run for Gemini or Vertex
- `harness:package-smoke`: Windows packaging smoke scaffold; validates packaging config by default and only inspects built artifacts when explicitly opted in

All harnesses write versioned JSON summaries under `artifacts/harness/` by default.

## Commands

```bash
npm run harness:core
npm run harness:eval
npm run harness:ui
npm run harness:live
npm run harness:package-smoke
```

Optional output override:

```bash
node scripts/harness/core.cjs --output artifacts/harness/custom-core.json
```

## JSON Result Contract

Harness artifacts use `schemaVersion: 1` and keep the same agent-facing top-level fields across deterministic, UI, and live runs:

- `suite`: stable suite id such as `harness-core`
- `status`: `passed`, `failed`, or `skipped`
- `cases`: per-case results with `id`, `title`, `status`, `durationMs`, and optional `details` or `error`
- `metrics`: suite-level counters or scores for quick triage
- `artifacts`: related files such as task manifests, fixture corpus paths, raw UI results, or workspace paths
- `reproCommand`: command an agent can rerun to reproduce the result
- `failureHints`: concise next steps when a suite fails or is skipped

`results` is still emitted as a compatibility alias for older consumers; new tools should read `cases`.

## Deterministic Harnesses

`harness:core` and `harness:eval` build `dist-main/` as needed, import compiled modules, and run without live provider access.

They validate:

- block splitting and chunk validation invariants
- provider readiness and cache-key semantics
- JSON verification and repair behavior
- bulk translation workflow behavior with a mocked translator
- fixture corpus scoring for structure and repair cases

`harness:core` and `harness:eval` also write `*-task-manifest.json` files, which list deterministic case ids and fixture inputs. The core manifest records the mock-provider scaffold used by the bulk translation workflow.

## UI Harness

`harness:ui` builds the renderer and main process, launches Electron with a private harness workspace, and records snapshots from:

- home/main window
- LLM settings window
- compare window
- JSON verify window

The UI harness uses stable `data-*` attributes and DOM text instead of pixel-based visual tests.

## Live Harness

`harness:live` is optional and exits cleanly with a skipped result when credentials are not present.

Environment variables:

- Gemini: `GEMINI_API_KEY`, `LLM_HARNESS_MODEL`
- Vertex: `VERTEX_SERVICE_ACCOUNT_JSON`, `VERTEX_LOCATION`, `LLM_HARNESS_MODEL`
- Optional selector: `LLM_HARNESS_PROVIDER=gemini|vertex`

## Packaged Windows Smoke Scaffold

`harness:package-smoke` is intentionally lightweight because producing the portable zip and NSIS installer is expensive for routine agent validation.

- Default mode: validates `package.json` packaging invariants (`asar`, Windows `zip`/`nsis` targets, and compiled-only file globs), writes `artifacts/harness/harness-package-smoke.json`, and exits cleanly as `skipped` when the scaffold is healthy.
- Opt-in mode: after a packaging build has already been produced, run `LLM_TSUKURU_PACKAGE_SMOKE=1 npm run harness:package-smoke` to verify that both `.zip` and `.exe` artifacts exist in the configured output directory.
- TODO before release: extend the opt-in mode to launch the portable artifact in a disposable profile and assert the same stable UI markers used by `harness:ui`.

## CI

- `.github/workflows/ci.yml` runs deterministic harnesses on PRs and pushes.
- `.github/workflows/harness-live.yml` provides a manual live-provider workflow.
- CI uploads `artifacts/harness/` so failures remain inspectable after the job ends.
