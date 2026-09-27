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

Wolf follows a parallel flow, but the extract/apply stages operate on Wolf-specific binary formats and text caches. Map parsing validates the tile byte span and advances the binary cursor without materializing unused tile numbers. Event parsing and its original-byte offsets are preserved.

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
- `LlmSettingsPage.vue`: translation-launch tab (also supports a standalone window)
- `LlmComparePage.vue`: block mismatch and untranslated review
- `JsonVerifyPage.vue`: structural verification, repair, and LLM shift repair
- `AgentWorkspacePage.vue`: approval queue, environment status, MCP setup, CLI presets, and real terminal sessions

The main workspace is resizable. `useProjectSession` retains only the active, already selected
project and extraction/application tab for the current renderer session; the home page offers
a return action. It does not persist paths or grant filesystem access. Selecting a different
engine's project replaces this session context. `ProjectSnapshot` reports the current top-level
extracted text file count through the existing restricted preload bridge, refreshing on focus,
operation completion, or explicit refresh. This is file presence evidence, not translation or
verification completion. The pipeline buttons are tool navigation, not completion indicators.

Translation launch summarizes the configured language, provider, model, and optional user
instructions; request tuning and guideline generation are expandable. Compare and JSON review
keep selected-item actions contextual and file-wide operations expandable. Native checkbox
labels support keyboard selection; the comparison editor exposes line/structure diagnostics
before explicit manual repairs; manual repair may intentionally restore a broken line layout.

### Single-window workspace

Main-window requests for translation, comparison, JSON verification, and settings now send
`workspaceNavigate` instead of creating another BrowserWindow. `App.vue` owns the persistent
title bar, project header, review navigation, and activity status. Its project-keyed KeepAlive
preserves each tool's editing state when switching tabs, including through home and AI tools.
Selecting a different project disposes all cached views. Before opening the native project
picker, the renderer blocks active operations and confirms discarding unsaved text/settings/drafts.
Inline settings open/save/close must never emit `worked`: that signal belongs to project operations.
Standalone tool callers retain their window behavior; inline close actions navigate back and must
never close `ctx.mainWindow`.

`useReviewWorkspace` shares measured counts and the current filename between text and JSON
review. Exact filename stems link the two views; this does not infer JSON-path-to-block mapping.
First mounts send `compareReady`/`verifyReady` with `fresh: true`, while KeepAlive reactivations
request readiness without discarding edits. Explicit disk reload/recheck actions refresh external
changes and confirm discarding outstanding edits or repair previews. Project-wide review uses bounded asynchronous
file-pair reads, yields between heavy summaries, and commits only the current scan generation. Revoked/replaced
preload path grants reject pending reads before content is returned. KeepAlive retains editing state; disposal
invalidates unfinished scans. Individual selected-file reads and CPU-heavy single-file parsing remain synchronous. Wolf text status reads
`_Extract/Texts`; JSON review is available for MV/MZ only.

Text review sends `compareSaveText` with the content originally loaded by the editor and the intended replacement. Main verifies the active project/window, destination and preimage, shares the translation-directory lock, then atomically replaces the file. Project changes while queued cancel the write; conflicts keep local edits dirty. Whole-map auto-fix uses the same per-file contract and reports a stopped/partially completed operation. Unlike agent same-line patches, explicit manual repair may change line counts. Preload no longer exposes a raw writeFileSync capability. This is preimage checking immediately before replacement, not a filesystem-wide compare-and-swap lock against arbitrary external processes.

`useWorkspaceDrafts` retains locally edited fields when refreshed persisted settings arrive.
Settings save success/failure and translation-submit acknowledgements release their own UI locks.
The AI tool tab can prepare a read-only review prompt for the selected file; preparation neither
starts a CLI nor transmits the file. The existing terminal and mutation-approval flow remain explicit.

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

`AgentService` assembles offline analysis services. `MutationApprovalRuntime` owns its `ApprovalService` directly and executes through `mutationPatchExecutor.ts`; starting approval handling does not construct the analysis kernel. `PatchService` provides proposal/validation/preview only, reusing `validatePatchApplyProposalRequest` for current-file and application-contract validation. `src/ts/libs/translationSyntax.ts` owns pure before/after structural rules shared by translation, comparison, QA, proposal validation, approval and post-write verification. It classifies both sides, including Wolf numeric-hyphen separators and percent control codes. Producerless job storage, unused QA wrappers and the unconsumed event-history bus have been removed; approval state, durable audit records and the runtime onChanged notification remain. There is no second direct-write MCP mutation registry.

### Public MCP Contracts

`src/mcp/agentTools.ts` directly defines 16 offline tools with explicit input schemas; `bridgeTools.ts` adds three app-bridge tools. The public surface groups project discovery, exact text access, structural inspection, bounded patch preparation, artifact pagination, terminology lookup and help. See [AGENT_MCP_GUIDE.md](AGENT_MCP_GUIDE.md) for the tool list and migration from the former larger surface. The former legacy registry, job graphs, workflow recipes, batch/corpus planning and repair-loop simulations are removed; tests exercise the same public definitions as the stdio server.

QA reads source/target once per request and passes those bounded snapshots into alignment. Structural alignment is pure analysis; artifact identity and persistence stay in the service boundary. Glossary and memory snapshots are request-local, never retained across external file edits.

`TranslationReadService` supplies `translation.read_window` and literal `translation.search`. It reads complete UTF-8 files up to 8 MiB for hashing and validation, keeps one decoded string plus a line count, and materializes only requested rows or search matches. It preserves physical empty lines and line endings, includes hashes of original bytes and bounds result sizes. Same-position source/target rows are context, not proof that dialogue is aligned. Response redaction must be checked before using text as a patch precondition.

`alignment.inspect` and `qa.score_file` return compact summaries, coverage and artifact references. Partial reads cannot pass the structural gate, and semantic translation quality is explicitly not evaluated. `artifacts.read_ref` pages selected arrays with `collection`, `offset` and `limit`, preserving valid JSON and continuation offsets instead of clipping serialized content. Saved artifacts let agents inspect additional findings without rerunning the same analysis. `artifactPaging.ts` keeps large arrays in immutable generation-scoped pages of at most 4096 items / 512 KiB; a small manifest is published only after every page is durable. Creation and reading share the 16 MiB JSON-record budget and 48 KiB response-item budget; creation also caps total output at 64 MiB. Readers load only intersecting pages, retain existing continuation arguments, and still support legacy inline JSON. Failed generations are removed without replacing an existing manifest. Saved analysis history (including pages from prior overwritten generations) is not automatically pruned.

`patch.propose` accepts exact original/replacement text for each line and includes its preview in the response. `patch.validate` checks an existing proposal against current bytes. Applicable patches retain the approval runtime's 256 KiB file, 100-operation and 8 KiB line bounds; oversized proposals/previews fail rather than inspecting only a file prefix. Virtual notes are analysis-only and inapplicable. A valid proposal does not imply approval or execution, and approval/execution revalidation still protects against later file changes.

## Shared Translation and View State

- `providerTranslationBase.ts` owns common provider configuration and translation retry/chunk handling. `translationPrompt.ts` builds prompts, preserving the existing Google/standard wording variants. `translationCore.ts` shares API error parsing; `providerRegistry.ts` owns provider selection and cache/config fingerprints.
- Compare and verify views derive filters and editing indicators from their source state with Vue computed values. Compare problem navigation includes unmatched blocks on either side.
- Agent Workspace keeps environment and executable-detection responses per page instance, deriving preset readiness and the timeline from those signals without modifying shared preset definitions.
- The file translation coordinator queues paths and reads source text only when bounded workers start it. A run reuses its provider client (including Vertex authentication) and the shared request scheduler. `translationCache.ts` lazily reads per-key atomic cache records instead of rewriting or loading an aggregate cache; fully recognized legacy aggregate files migrate before removal. Mixed-validity input recovers good entries but retains the original plus an import fingerprint so later cache invalidations cannot revive old values; unknown versions or malformed JSON are retained with a warning. Known stale output temporaries are cleaned once per directory, while each successful file/cache/progress write keeps its own fsync. Provider failures remain per-file results; completion-handler failures stop new work and propagate after in-flight workers settle, before the directory lock is released. Bulk translation and retranslation share the same line-array block parser. Run cancellation aborts provider HTTP through a shared AbortSignal; active workers still settle before the directory lock is released. External cancellation is observed while an active request remains even if its queue is empty. Client cancellation does not establish provider-side billing cancellation.
- JSON Verify LLM repair preserves exact provider whitespace before validation, without caller-level trim.
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
