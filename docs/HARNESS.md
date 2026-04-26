# Harness

## Goals

The harness stack exists to make the repository self-checking for both humans and coding agents.

- `harness:core`: deterministic checks against compiled main-process modules and translation workflow semantics
- `harness:eval`: curated fixture corpus scored by structural and repair metrics
- `harness:ui`: Electron smoke harness that opens real windows and inspects stable UI state
- `harness:live`: optional real-provider smoke run for Gemini or Vertex

All harnesses write JSON summaries under `artifacts/harness/` by default.

## Commands

```bash
npm run harness:core
npm run harness:eval
npm run harness:ui
npm run harness:live
```

Optional output override:

```bash
node scripts/harness/core.cjs --output artifacts/harness/custom-core.json
```

## Deterministic Harnesses

`harness:core` and `harness:eval` build `dist-main/` as needed, import compiled modules, and run without live provider access.

They validate:

- block splitting and chunk validation invariants
- provider readiness and cache-key semantics
- JSON verification and repair behavior
- bulk translation workflow behavior with a mocked translator
- fixture corpus scoring for structure and repair cases

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

## CI

- `.github/workflows/ci.yml` runs deterministic harnesses on PRs and pushes.
- `.github/workflows/harness-live.yml` provides a manual live-provider workflow.
- CI uploads `artifacts/harness/` so failures remain inspectable after the job ends.
