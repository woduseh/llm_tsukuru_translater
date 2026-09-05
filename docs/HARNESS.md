# Verification

Choose checks for the changed behavior; this is a command reference, not a checklist for every task. Harnesses exercise production modules or real Electron windows using deterministic fixtures. Live providers are opt-in.

## Agent Verification Loop

`npm run verify:plan` prints a JSON plan without running checks or writing artifacts. `npm run verify` executes that plan. Both inspect the effective working-tree difference from HEAD, including staged, unstaged, deleted, renamed (both paths), and untracked files. For already committed work use `npm run verify -- --base <ref>`; this compares the checkout directly to that ref, not its merge base. `npm run verify:full` runs all deterministic CI gates regardless of the diff.

| Changed surface | Automatic checks |
| --- | --- |
| Markdown only or no changes | Explicit `skipped`; no verification claim |
| Unit tests/test utilities | Both typechecks, lint, all unit tests |
| Translation, extraction, Wolf, agent kernel, MCP | Above plus clean main build, core and eval |
| Renderer, IPC, preload, app bootstrap, UI harness, terminal/bridge runtime | Above plus renderer/MCP builds and real Electron UI harness |
| Config, scripts, fixtures, shared types, unknown paths, or `--full` | All checks, unit coverage, UI and package smoke |

The complete unit suite is intentionally retained: it is short and includes cross-module regressions that filename-based test selection could miss. Rules live in `scripts/verify.cjs`; unclassified executable inputs conservatively select the full set. The plan is a starting point, not proof that a new feature has adequate tests.

Each run writes `artifacts/verify/<run-id>/result.json`, individual check logs, and harness JSON files. `artifacts/verify/latest.json` points to the same run via its `reportPath` field and contains the full summary. Reports are updated before and after checks; an interrupted process leaves `running`, not an old success. Commands are stored as executable plus an argument array so spaces/quotes do not require guessing shell escapes.

Checks execute serially. A failed check does not prevent independent checks from running, but failed build dependencies mark their harnesses `blocked`. Main TypeScript output is cleaned and compiled once for core/eval/UI. Builds in the current run must pass before those harnesses receive `LLM_TSUKURU_SKIP_BUILD=1`; inherited skip-build, packaged-UI executable, and package-smoke opt-ins are removed. Live provider checks are never selected. Avoid concurrent builds or verify runners in one checkout because build outputs are shared.

The runner requires both successful process exit and valid nonempty harness evidence. It records skipped package cases separately; those are not passed checks. It hashes Git-listed file contents (including untracked non-ignored files) before and after execution. A changed fingerprint yields `stale` and a nonzero exit even if the checks passed. This catches edits during verification, not transient edits reverted before completion or changes under ignored paths such as `node_modules`. After changing dependencies, install from the lockfile before verification.

For failures, read the failed check's `logPath` and `error`/`failureHint`; fix the cause and rerun the appropriate command. EPERM during process creation is an execution-environment failure, not a test assertion. Full logs are retained locally while console output includes a bounded failure tail. Existing individual commands below remain supported for focused diagnosis.

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Main TypeScript and renderer Vue types |
| `npm run lint` | Main/renderer TypeScript and Vue lint |
| `npx vitest run test/unit/<file>.test.ts` | Focused regression suite |
| `npm test` | All unit tests |
| `npm run harness:core` | Compiled translation workflows, provider/cache behavior, bundled MCP handshake and submit → app approve/apply → status |
| `npm run harness:eval` | Fixture corpus with exact issue type/path/severity expectations, valid-input controls, structural preservation and repair |
| `npm run harness:ui` | Real Electron project selection, preload IPC, compare/verify state, approval UI and exact applied bytes, MCP commands and terminal surface |
| `npm run harness:package-smoke` | Packaging configuration, native PTY loading in the current Node runtime and local CSS assets; packaged artifact checks are opt-in |
| `npm run harness:live` | Opt-in provider smoke for separators, line counts, ordered control codes and empty lines; skips when credentials are absent |

Core/eval build main modules as needed; UI builds the app. `build:ts` clears `dist-main` before compiling so deleted source files cannot leave stale packaged modules. `LLM_TSUKURU_SKIP_BUILD=1` reuses existing outputs only when the caller has already built the current source.

UI runs with temporary settings, user-data, session and log directories. It replaces the native folder picker with a fixture selection and uses the production project initialization and preload IPC. It shuts down the bridge and removes its manifest before exiting. UI assertions use DOM state and `data-*` attributes, so they do not establish visual fidelity or full real-game compatibility.

Vitest also mounts the real compare Vue component in jsdom (`test/unit/comparePage.test.ts`) to exercise editing, badges, navigation and saving. The in-process MCP client helper is under `test/utils/`; production protocol behavior is exercised through the actual stdio handler and bundled-server harness.

Harness regression tests inject incorrect verifier results, corrupt translations and native module load failures. Native PTY fallback is checked against the real adapter and terminal service in `test/unit/packageHarness.test.ts`; package smoke alone does not establish fallback behavior. The eval score is the pass percentage of its fixture corpus, not a general translation-quality score.

## Results

Versioned JSON is written under `artifacts/harness/`. Example output override:

```powershell
node scripts/harness/core.cjs --output artifacts/harness/custom-core.json
```

The `schemaVersion: 1` contract includes `suite`, `status` (`passed`, `failed`, `skipped`), `cases`, `metrics`, `artifacts`, `reproCommand` and `failureHints`. Cases include id, title, status, duration and optional details/error. `results` is a legacy alias; consumers use `cases`. Core/eval also emit task manifests with case IDs and fixture references.

## Packaged Windows Checks

After `npm run dist:all`, check that both current-version portable and Setup executables exist:

```powershell
$env:LLM_TSUKURU_PACKAGE_SMOKE = '1'
npm run harness:package-smoke
Remove-Item Env:LLM_TSUKURU_PACKAGE_SMOKE
```

That command checks artifact presence, not app launch. To run the UI flow against an unpacked or installed executable with a private harness workspace:

```powershell
$env:LLM_TSUKURU_UI_HARNESS_EXECUTABLE = 'C:\path\to\app.exe'
npm run harness:ui
Remove-Item Env:LLM_TSUKURU_UI_HARNESS_EXECUTABLE
```

A healthy default package smoke reports `skipped` for the opt-in portion; inspect its individual base checks. Its native-load case is also `skipped` when the current Node runtime cannot load the module. Neither result is evidence that a packaged Electron app or its terminal launched successfully.

## Live Providers

Set `LLM_HARNESS_PROVIDER` to `gemini`, `vertex`, `openai`, `custom-openai` or `claude`, with `LLM_HARNESS_MODEL` and the corresponding environment variables:

| Provider | Configuration |
| --- | --- |
| Gemini | `GEMINI_API_KEY` |
| Vertex | `VERTEX_SERVICE_ACCOUNT_JSON`, `VERTEX_LOCATION` |
| OpenAI | `OPENAI_API_KEY` |
| OpenAI-compatible | `CUSTOM_OPENAI_BASE_URL`, optional `CUSTOM_OPENAI_API_KEY` |
| Claude | `CLAUDE_API_KEY`, optional `CLAUDE_MAX_TOKENS` |

Use live results with their provider, model and run date. Credential values do not belong in reports.

## CI

[ci.yml](../.github/workflows/ci.yml) runs `npm run verify:full` (typecheck, lint, unit coverage, core/eval/UI and default package smoke) on main pushes/PRs and uploads verification logs and harness artifacts even on failure. [harness-live.yml](../.github/workflows/harness-live.yml) is manually triggered. CI gates do not require every local edit to rerun all suites.
