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
- MCP registration commands contain only `--bridge-manifest <path>`. The stdio adapter derives the project from its copied bundle, verifies the project hash, and exposes proxy `patch.apply` plus read-only `approval.status` and `bridge.status`. Registration does not establish live connectivity; the status tool checks the current bridge.
- `patch.apply` only submits a bounded proposal. External agents cannot approve or deny it; an explicit app-UI approval lets the main-process runtime execute that one bound patch.
- The mutation executor revalidates the canonical project, source bytes, argument/preview hashes, original lines, separators, empty lines, and RPG control codes before a same-directory atomic replacement. It preserves BOM, per-line CRLF/LF separators, final-newline state, and file mode, then re-reads the result and atomically restores the exact preimage if verification fails.
- Renderer terminal sessions come from the main-process `TerminalService`; the renderer does not create placeholder sessions.

`AgentService` assembles offline analysis services. `MutationApprovalRuntime` owns its `ApprovalService` directly and executes through `mutationPatchExecutor.ts`; starting approval handling does not construct the analysis kernel. `PatchService` provides proposal/validation/preview only, reusing `validatePatchApplyProposalRequest` for current-file and application-contract validation. `rpgTextInvariants.ts` holds shared separator/control-code helpers without a dependency on patch services. There is no second direct-write MCP mutation registry.

### Public MCP Contracts

`src/mcp/agentTools.ts` curates 16 offline tools with explicit input schemas; `bridgeTools.ts` adds three app-bridge tools. The public surface groups project discovery, exact text access, structural inspection, bounded patch preparation, artifact pagination, terminology lookup and help. See [AGENT_MCP_GUIDE.md](AGENT_MCP_GUIDE.md) for the tool list and migration from the former larger surface. Internal job graphs, workflow recipes and repair-loop simulations are not registered as externally executable work.

`TranslationReadService` supplies `translation.read_window` and literal `translation.search`. It reads complete UTF-8 files up to 8 MiB, preserves physical empty lines and line endings, includes hashes of original bytes and bounds result sizes. Same-position source/target rows are context, not proof that dialogue is aligned. Response redaction must be checked before using text as a patch precondition.

`alignment.inspect` and `qa.score_file` return compact summaries, coverage and artifact references. Partial reads cannot pass the structural gate, and semantic translation quality is explicitly not evaluated. `artifacts.read_ref` pages selected arrays with `collection`, `offset` and `limit`, preserving valid JSON and continuation offsets instead of clipping serialized content. Saved artifacts let agents inspect additional findings without rerunning the same analysis.

`patch.propose` accepts exact original/replacement text for each line and includes its preview in the response. `patch.validate` checks an existing proposal against current bytes. Applicable patches retain the approval runtime's 256 KiB file, 100-operation and 8 KiB line bounds; oversized proposals/previews fail rather than inspecting only a file prefix. Virtual notes are analysis-only and inapplicable. A valid proposal does not imply approval or execution, and approval/execution revalidation still protects against later file changes.

## Shared Translation and View State

- `providerTranslationBase.ts` owns common provider configuration and translation retry/chunk handling. `translationPrompt.ts` builds prompts, preserving the existing Google/standard wording variants. `translationCore.ts` shares API error parsing; `providerRegistry.ts` owns provider selection and cache/config fingerprints.
- Compare and verify views derive filters and editing indicators from their source state with Vue computed values. Compare problem navigation includes unmatched blocks on either side.
- Agent Workspace keeps environment and executable-detection responses per page instance, deriving preset readiness and the timeline from those signals without modifying shared preset definitions.
- The file translation coordinator uses bounded async workers. Provider failures remain per-file results; completion-handler failures stop new work and propagate after in-flight workers settle, before the directory lock is released. Bulk translation and retranslation share the same line-array block parser.
- JSON Verify uses the pure `setAtPath` from `src/ts/rpgmv/verify.ts` locally; the actual file write still goes through validated main-process IPC.

## Build and IPC Details

- `tsconfig.main.json` extends `tsconfig.json` and compiles main-process code into `dist-main/`; Vite builds Vue into `dist-renderer/`. Generated output is not source.
- Windows packaging runs `@electron/rebuild` for the native `node-pty` terminal dependency. The scoped `overrides` entry in `package.json` selects `node-gyp ^12.1.0` for Visual Studio 2026 (18.x) discovery; the lockfile pins the resolved version. Keep native rebuilding enabled and `node_modules/node-pty/**` in `asarUnpack`. Reassess the override when upgrading `@electron/rebuild` to a release that directly supports the required toolchain. See [Windows packaging checks](HARNESS.md#packaged-windows-checks).
- Vue uses hash routing for packaged `file://` URLs. `App.vue` receives global theme updates across routes. `useIpcOn` disposes only its own subscription on component unmount, using the unsubscribe callback returned by preload `api.on`. Add IPC channels to the whitelist for their actual direction in `src/preload.ts`.
- Sub-window route components mount after `did-finish-load`. Main retains pending data until the component sends its ready signal from `onMounted`; see `toolsHandler.ts` for compare/verify examples.
- Existing windows use `sandbox: false` for the current Node-dependent preload. This is an implementation dependency to reassess when changing preload, not a requirement for every future window.

## Extracted Metadata

MV/MZ `.extracteddata` is compressed JSON handled by `src/ts/rpgmv/edtool.ts`. A record keyed by text line number contains `val` (dotted JSON path), `m` (exclusive end line), `origin` (source JSON filename), and extraction configuration in `conf`. Changing text line positions without updating this mapping can apply dialogue to the wrong entry.

Harness entrypoints and coverage are in [HARNESS.md](HARNESS.md).
