# Verification

Choose checks for the changed behavior; this is a command reference, not a checklist for every task. Harnesses exercise production modules or real Electron windows using deterministic fixtures. Live providers are opt-in.

## Agent Verification Loop

Start a new checkout with `npm ci`, then `npm run doctor`. Doctor checks the documented Windows/Node 22 runtime, lockfile/direct dependencies, the local Electron binary, write/remove access, child-process pipes, Git and a loopback bind/close. It makes no external requests and prints environment variable names only. Read `artifacts/doctor/latest.json`; `failed` exits nonzero, while a runtime `warning` does not establish CI compatibility. A fresh install needs registry/Electron download access and enabled install scripts.

`npm run dev` builds main/MCP, waits for Vite on its own `127.0.0.1` ephemeral port, then launches Electron with a new private profile. `npm run dev -- --smoke` waits for the home component's production `mainReady` IPC, validates its renderer URL and exits. Close the app or use Ctrl+C to stop an interactive run. Logs/result remain under `artifacts/dev/`; settings, bridge credentials and session data are removed after shutdown. Check `privateStateRemoved` and cleanup errors. Main/preload edits require a restart. Separate worktrees need their own install/build outputs; do not build twice in the same checkout. The low-level `dev:renderer`/`dev:electron` scripts still require manually prepared main/MCP output and port 5173; Vite now fails if that port is occupied.

`npm run verify:plan` prints a JSON plan without running checks or writing artifacts. `npm run verify` executes that plan. Both inspect the effective working-tree difference from HEAD, including staged, unstaged, deleted, renamed (both paths), and untracked files. For already committed work use `npm run verify -- --base <ref>`; this compares the checkout directly to that ref, not its merge base. `npm run verify:full` runs all deterministic CI gates regardless of the diff.

| Changed surface | Automatic checks |
| --- | --- |
| Markdown only or no changes | Explicit `skipped`; no verification claim |
| Unit tests/test utilities | Tooling tests, both typechecks, lint, all Vitest tests |
| Translation, extraction, Wolf, agent kernel, MCP | Above plus clean main/MCP builds, core and eval |
| Renderer, IPC, preload, app bootstrap, UI harness, terminal/bridge runtime | Above plus renderer/MCP builds and real Electron UI harness |
| Config, scripts, fixtures, shared types, unknown paths, or `--full` | All checks, unit coverage, UI and package smoke |

The complete unit suite is intentionally retained: it is short and includes cross-module regressions that filename-based test selection could miss. Rules live in `scripts/verify.cjs`; unclassified executable inputs conservatively select the full set. The plan is a starting point, not proof that a new feature has adequate tests.

Each run writes `artifacts/verify/<run-id>/result.json`, individual check logs, and harness JSON files. `artifacts/verify/latest.json` points to the same run via its `reportPath` field and contains the full summary. Reports are updated before and after checks; an interrupted process leaves `running`, not an old success. Commands are stored as executable plus an argument array so spaces/quotes do not require guessing shell escapes.

Git/fingerprint/tool-resolution failures also replace `latest.json` with a new `failed` report containing the preparation phase and error code. No checks ran when `checks` is empty. `--plan` remains read-only, including on failure.

Checks execute serially. A failed check does not prevent independent checks from running, but failed build dependencies mark their harnesses `blocked`. Main TypeScript output is cleaned and compiled once for core/eval/UI. The MCP bundle is built once as an explicit dependency of core/UI. Builds in the current run must pass before those harnesses receive `LLM_TSUKURU_SKIP_BUILD=1`; inherited skip-build, packaged-UI executable, and package-smoke opt-ins are removed. Live provider checks are never selected. Avoid concurrent builds or verify runners in one checkout because build outputs are shared.

The runner requires both successful process exit and valid nonempty harness evidence. Core/eval/UI cannot pass with skipped cases; package smoke must have at least one passed case and records its intentional skips separately. It hashes Git-listed file contents (including untracked non-ignored files) before and after execution. A changed fingerprint yields `stale` and a nonzero exit even if the checks passed. This catches edits during verification, not transient edits reverted before completion or changes under ignored paths such as `node_modules`. After changing dependencies, install from the lockfile before verification.

For failures, read the failed check's `logPath` and `error`/`failureHint`; fix the cause and rerun the appropriate command. EPERM during process creation is an execution-environment failure, not a test assertion. Full logs are retained locally while console output includes a bounded failure tail. Existing individual commands below remain supported for focused diagnosis.

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Main TypeScript and renderer Vue types |
| `npm run lint` | Main/renderer TypeScript and Vue lint |
| `npm run test:tooling` | Node built-in tests for environment checks, launch/cleanup and verification evidence; no Vite/esbuild startup required |
| `npx vitest run test/unit/<file>.test.ts` | Focused regression suite |
| `npm test` | All unit tests |
| `npm run harness:core` | Compiled translation workflows, provider/cache behavior, bundled MCP handshake and submit → app approve/apply → status |
| `npm run harness:eval` | Fixture corpus with exact issue type/path/severity expectations, valid-input controls, structural preservation and repair |
| `npm run harness:ui` | Real Electron project selection, preload IPC, compare/verify state, approval UI and exact applied bytes, MCP commands and terminal surface |
| `npm run harness:package-smoke` | Packaging configuration, native PTY loading in the current Node runtime and local CSS assets; packaged artifact checks are opt-in |
| `npm run harness:live` | Opt-in provider smoke for separators, line counts, ordered control codes and empty lines; skips when credentials are absent |

Standalone core builds main modules and the MCP bundle; eval builds main modules; UI builds the app. `build:ts` clears `dist-main` before compiling so deleted source files cannot leave stale packaged modules. `LLM_TSUKURU_SKIP_BUILD=1` reuses existing outputs only when the caller has already built all outputs needed by that harness from the current source.

UI runs with temporary settings, user-data, session and log directories. It ignores inherited development URLs, profile overrides and Electron Node mode, and resolves the Electron binary from this checkout. It replaces the native folder picker with a fixture selection and uses the production project initialization and preload IPC. It shuts down the bridge and removes its manifest before exiting. The parent preserves fixture/log/screenshot evidence and removes private profiles after process completion. Cleanup failure is a failure; an unconfirmed process-tree shutdown retains the profile for diagnosis.

UI workspaces retain `build.log` and, once Electron starts, `electron.log`, `progress.json` and home/compare/verify PNGs. Failure capture is best-effort: `diagnostics.json` contains structural window state, with no form values or HTML dump. `npm run harness:ui -- --fail-at home` changes the expected fixture heading and must exit nonzero. Check for the home-stage assertion; a build/setup failure or a package that ignores the fault scenario does not establish that assertion ran. UI assertions/screenshots do not establish visual fidelity or full real-game compatibility. Tooling tests use Vite/Electron stand-ins and establish orchestration contracts only.

JSON review action coverage lives in `src/harness/jsonReviewHarness.ts`. It clicks the real
Electron renderer and checks disk contents for selected revert, current/all structural repair,
partial failure, LLM preview cancellation/application, and external edits both before application
and between renderer validation and the main-process write. Only `verifyLlmRepair` responses are
stubbed; saves use the production IPC and atomic writer. This establishes deterministic interaction
and file-integrity behavior, not live-provider output quality or real-game compatibility.

Vitest also mounts the real compare Vue component in jsdom (`test/unit/comparePage.test.ts`) to exercise editing, badges, navigation and saving. The in-process MCP client helper is under `test/utils/`; production protocol behavior is exercised through the actual stdio handler and bundled-server harness.

Harness regression tests inject incorrect verifier results, corrupt translations and native module load failures. Native PTY fallback is checked against the real adapter and terminal service in `test/unit/packageHarness.test.ts`; package smoke alone does not establish fallback behavior. The eval score is the pass percentage of its fixture corpus, not a general translation-quality score.

## Results

Versioned JSON is written under `artifacts/harness/`. Example output override:

```powershell
node scripts/harness/core.cjs --output artifacts/harness/custom-core.json
```

The `schemaVersion: 1` contract includes `suite`, `status` (`passed`, `failed`, `skipped`), `cases`, `metrics`, `artifacts`, `reproCommand` and `failureHints`. Cases include id, title, status, duration and optional details/error. `results` is a legacy alias; consumers use `cases`. Core/eval also emit task manifests with case IDs and fixture references.

## Packaged Windows Checks

Native compilation prerequisites are listed in the [production build guide](../readme.md#프로덕션-빌드). `doctor` does not inspect Python, Visual Studio components or native compilation readiness.

If `node-pty` rebuilding fails with `Could not find any Visual Studio installation to use`, inspect both the installed Visual Studio version and the project's dependency chain:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -all -products '*' -format json
npm ls node-gyp @electron/rebuild
```

Visual Studio 2026 (18.x) requires `node-gyp` 12.1.0 or newer; 11.x can reject an otherwise complete installation. The scoped npm override selects 12.x, and the lockfile currently resolves 12.4.0. After pulling the manifest/lockfile change, run `npm ci`. When intentionally changing the override, run `npm install` and commit both files. Updating a global `node-gyp` does not update the copy used by `@electron/rebuild`. Do not disable native rebuilding to hide discovery failures. The `DEP0169`/`DEP0190` warnings alone do not establish why a build failed; inspect the subsequent fatal error. See the [node-gyp VS 2026 support release](https://github.com/nodejs/node-gyp/releases/tag/v12.1.0).

For a native-toolchain fix, run `npm run dist:portable`, require a zero exit code, and confirm the current-version executable under `dist/` was generated by that run. On 2026-09-05, Windows x64 with Node 24.14.0, VS Build Tools 2026 18.9 and `node-gyp` 12.4.0 completed the `node-pty` rebuild and portable packaging. This is a local build result; CI remains on Node 22, and packaged app/terminal launch requires separate runtime checks.

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

[ci.yml](../.github/workflows/ci.yml) and the tag gate in [release.yml](../.github/workflows/release.yml) run `npm run verify:full` (tooling, typecheck, lint, unit coverage, core/eval/UI and default package smoke) and upload verification logs and harness artifacts even on failure. [harness-live.yml](../.github/workflows/harness-live.yml) is manually triggered. CI gates do not require every local edit to rerun all suites.
