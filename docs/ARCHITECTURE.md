# Architecture

## Runtime Shape

The app is an Electron desktop tool for translating RPG Maker MV/MZ and Wolf RPG Editor projects. Dependency versions and build commands are defined in `package.json`.

- `main.ts` boots the Electron main process and registers IPC handlers.
- `src/ipc/` owns window lifecycle and renderer-to-main actions.
- `src/renderer/` is a Vue 3 SPA loaded through hash routes.
- `src/ts/rpgmv/` contains the MV/MZ extract, translate, apply, and verify pipeline.
- `src/ts/wolf/` contains the Wolf RPG extract/apply pipeline.
- `src/ts/libs/` contains shared translation, provider, file, and validation utilities.
- `src/agent/` contains the analysis kernel, project-protecting workspace services, QA, and terminal runtime.
- `src/mcp/` exposes the offline stdio MCP surface and the authenticated app-bridge proxy used by external Codex or Claude CLIs.
- `src/harness/` contains the in-app Electron UI smoke runtime.

## Core Translation Flow

### MV/MZ

1. Extract reads game `data/*.json`.
2. Extract writes `.txt` plus `.extracteddata`.
3. Translate reads extracted `.txt` files and calls the active provider.
4. Compare/verify expose structure and quality review tools.
5. Apply writes translated content back into JSON under `Completed/data` or in-place.

### Wolf

Wolf follows a parallel flow, but the extract/apply stages operate on Wolf-specific binary formats and text caches.

## Main Process Boundaries

- `src/ipc/windowManager.ts`: main window, route loading, global settings bootstrap
- `src/ipc/translateHandler.ts`: LLM settings, bulk translation, retranslate actions
- `src/ipc/toolsHandler.ts`: compare window, JSON verify window, verify-side LLM repair
- `src/ipc/settingsHandler.ts`: settings persistence and renderer-safe settings payloads
- `src/ipc/agentHandler.ts`: agent environment status, approval IPC, and MCP connection guidance
- `src/ipc/terminalHandler.ts`: managed terminal lifecycle and terminal events
- `src/preload.ts`: channel whitelist and secure bridge APIs

## Renderer Surfaces

- `HomePage.vue`: entry landing page
- `MvMzPage.vue` and `WolfPage.vue`: main operator screens
- `LlmSettingsPage.vue`: translation-launch window
- `LlmComparePage.vue`: block mismatch and untranslated review
- `JsonVerifyPage.vue`: structural verification, repair, and LLM shift repair
- `AgentWorkspacePage.vue`: approval queue, environment status, MCP setup, CLI presets, and real terminal sessions

## Agent and MCP Boundaries

- Translation and apply execution remain app UI responsibilities.
- The bundled offline MCP server may read project structure and translation quality state.
- Offline MCP writes are restricted to bounded analysis artifacts under `.llm-tsukuru-agent/`.
- When launched without an app bridge, the offline MCP surface does not expose a working source-project mutation path.
- The Electron main process owns one `MutationApprovalRuntime` and one HTTP bridge bound to `127.0.0.1` for the selected project.
- The per-process rendezvous manifest lives under Electron `userData/llm-tsukuru-agent-bridge/`, is blocked from renderer file APIs, and contains a rotating bearer plus app/project/bridge bindings.
- MCP registration commands contain only `--bridge-manifest <path>`. The stdio adapter derives the project from its copied bundle, verifies the project hash, and exposes proxy `patch.apply` plus read-only `approval.status`.
- `patch.apply` only submits a bounded proposal. External agents cannot approve or deny it; an explicit app-UI approval lets the main-process runtime execute that one bound patch.
- The mutation executor revalidates the canonical project, source bytes, argument/preview hashes, original lines, separators, empty lines, and RPG control codes before a same-directory atomic replacement. It preserves BOM, per-line CRLF/LF separators, final-newline state, and file mode, then re-reads the result and atomically restores the exact preimage if verification fails.
- Renderer terminal sessions come from the main-process `TerminalService`; the renderer does not create placeholder sessions.

`AgentService` assembles offline analysis services. `MutationApprovalRuntime` owns its `ApprovalService` directly and executes through `mutationPatchExecutor.ts`; starting approval handling does not construct the analysis kernel. `PatchService` provides proposal/validation/preview only. There is no second direct-write MCP mutation registry.

## Shared Translation and View State

- `providerTranslationBase.ts` owns common provider configuration and translation retry/chunk handling. `translationPrompt.ts` builds prompts, preserving the existing Google/standard wording variants. `translationCore.ts` shares API error parsing; `providerRegistry.ts` owns provider selection and cache/config fingerprints.
- Compare and verify views derive filters and editing indicators from their source state with Vue computed values. Compare problem navigation includes unmatched blocks on either side.
- JSON Verify uses the pure `setAtPath` from `src/ts/rpgmv/verify.ts` locally; the actual file write still goes through validated main-process IPC.

## Build and IPC Details

- `tsconfig.main.json` extends `tsconfig.json` and compiles main-process code into `dist-main/`; Vite builds Vue into `dist-renderer/`. Generated output is not source.
- Vue uses hash routing for packaged `file://` URLs. `useIpcOn` removes listeners on component unmount. Add IPC channels to the whitelist for their actual direction in `src/preload.ts`.
- Sub-window route components mount after `did-finish-load`. Main retains pending data until the component sends its ready signal from `onMounted`; see `toolsHandler.ts` for compare/verify examples.
- Existing windows use `sandbox: false` for the current Node-dependent preload. This is an implementation dependency to reassess when changing preload, not a requirement for every future window.

## Extracted Metadata

MV/MZ `.extracteddata` is compressed JSON handled by `src/ts/rpgmv/edtool.ts`. A record keyed by text line number contains `val` (dotted JSON path), `m` (exclusive end line), `origin` (source JSON filename), and extraction configuration in `conf`. Changing text line positions without updating this mapping can apply dialogue to the wrong entry.

Harness entrypoints and coverage are in [HARNESS.md](HARNESS.md).
