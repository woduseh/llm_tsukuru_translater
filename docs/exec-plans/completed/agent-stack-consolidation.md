# Agent Stack Consolidation Plan

Status: complete
Owner: 황재연 (review/approval), executing agent (implementation)
Scope: `src/agent/`, `src/mcp/`, `src/ipc/agentHandler.ts`, `src/renderer/` agent surfaces, `scripts/harness/`, related docs

## Accepted Execution Decisions

- Preserve the existing `PermissionTier` values: `readonly`, `workspace-write`, `approval-required`, and `dangerous`.
- The external offline MCP server may write analysis state only under `.llm-tsukuru-agent/`; it must never expose project-writing mutation tools.
- Keep `createMcpReadonlyToolRegistry` strict and add `createMcpOfflineToolRegistry` for the external `readonly` + `workspace-write` surface.
- Do not copy app settings into the project. Exclude `settings.get_sanitized`, `provider.readiness`, and `harness.latest` from the offline surface.
- Rename the unshipped bundle to `res/mcp-agent-server.cjs` so the filename does not claim full read-only behavior.
- Keep exited terminal sessions visible until the app exits. Renderer session lists must contain only real main-process summaries.
- Complete the deduplication and repository-hygiene phase, except for the optional tool-surface diet.

## Progress

- [x] Phase 0 — bundle and UI safety nets
- [x] Phase 1 — side-effect-free kernel and honest permissions
- [x] Phase 2 — product story alignment
- [x] Phase 3 — renderer session single source of truth
- [x] Phase 4 — deduplication and hygiene
- [x] Final deterministic verification

Phase 0 verification: `npm run build:mcp`, `npm run harness:core`, and `npm run harness:ui` passed on 2026-07-04.
Phase 1 verification: `npm run lint` (existing warnings only), `npx tsc -p tsconfig.main.json --noEmit`, `npm test` (530 tests), and `npm run harness:core` passed on 2026-07-04.
Phases 2–4 static verification: main and renderer TypeScript checks, Vue SFC parse/compile checks, ESLint (existing warnings only), Node syntax checks, `npm ls esbuild --depth=0`, and `git diff --check` passed on 2026-07-04.
Final verification: `npm run lint` (0 errors, 84 existing warnings), both TypeScript checks, `npm test` (529 tests), `npm run build:mcp`, `npm run harness:core` (6/6, bundled MCP handshake with 47 tools), `npm run harness:eval` (6/6, score 100), and `npm run harness:ui` (6/6, including `/agent-workspace`) passed on 2026-07-04.
Manual Windows terminal smoke: PowerShell reached `running`, process-tree kill returned `killed`, and the ended session remained in `terminalService.list()`. When this smoke is run directly under Node 24, node-pty's detached ConPTY helper prints an `AttachConsole failed` warning after the successful kill; the service result, unit suite, and Electron UI harness still pass.
Packaged v3.2.0 release smoke (2026-07-29): the published Windows ZIP (`sha256 1ffbcfe73675f01ba16ab113dcd0c89638246d9ac17c5955d828164e4c232531`) was run with an isolated profile and disposable MV/MZ project. A real PowerShell terminal-service session reached `running`; input/output and the selected project cwd were correct; and a nested `powershell.exe` child (PID 24324) was removed by the user-triggered process-tree kill. The UI changed the session to `killed` (`강제 종료됨`) and kept it in the session list while the app remained open. The packaged Electron/Node 24.13.1 runtime did reproduce node-pty's detached `conpty_console_list_agent.js` `AttachConsole failed` warning on stderr after kill, but no functional failure or process leak was observed because the service's explicit Windows process-tree cleanup completed successfully. Treat this as a known node-pty/Node 24 diagnostic limitation; no application code change is required unless a future runtime upgrade or smoke test shows an actual termination failure.
Interactive terminal editing follow-up (2026-07-29): comparison with RisuToki showed that Tsukuru Extractor removed all CSI sequences before writing PTY output to xterm, including PowerShell PSReadLine cursor and erase commands. The terminal output path now preserves a bounded allowlist of safe VT sequences while continuing to block OSC/DCS and device/window queries, redact secrets, and store plain-text transcripts. In the source Electron app with an isolated profile and disposable project, manual PowerShell smoke confirmed Backspace, Delete, left-arrow cursor movement, Home/End, and `Ctrl+C` line cancellation/redraw. Targeted terminal tests (18/18), both TypeScript checks, `npm test` (534/534), `npm run harness:ui` (6/6), and package-smoke base checks (8/8; opt-in packaged suite skipped) passed.

## Background

The repository contains two agent stacks that do not meet:

- **Stack A (app runtime)**: `agentHandler.ts` uses only executable detection, workspace status, MCP connection-command generation, and `terminalService`.
- **Stack B (AgentService kernel)**: ~7,600 lines under `src/agent/` (jobs, job graphs, workflows, approvals, patch, QA, repair loop, glossary, memory, batch, corpus). Reachable only from the MCP stdio server and unit tests. The mutation tool registry (`createMcpMutationToolRegistry`, approval-gated `patch.apply`) is wired into **no runtime at all**.

Consequences: the UI and starter prompts promise an approval/apply flow that does not exist end-to-end; the "readonly" tool tier includes state-writing tools; the read-only MCP server mutates the game project on boot; the renderer maintains a parallel session model that keeps causing regressions (3 of the last 5 commits are agent-workspace fixes); and neither the bundled MCP server nor the agent workspace page has harness coverage.

The goal is NOT to delete Stack B. The goal is to make the one real usage path — **external CLI (Codex/Claude) + project-protecting MCP server + in-app terminal** — correct, honest, and covered by harness, and to stop advertising anything beyond it until it is wired.

## Ground Rules

- Read `AGENTS.md`, `docs/QUALITY_RULES.md`, `docs/ARCHITECTURE.md` first. All invariants there apply.
- Do not weaken terminal security properties: env allowlist, secret redaction, cwd trust-boundary checks, paste confirmation, ring-buffer bounds, process-tree kill.
- Do not break the MCP handshake compatibility in `mcpStdioServer.ts` (protocol versions `2024-11-05` through `2025-06-18`).
- Keep deterministic CI deterministic. No live-provider calls in default test/harness paths.
- One phase per PR/commit series. Each phase must end green: `npm run lint`, `npm run test`, `npx tsc -p tsconfig.main.json --noEmit`, `npm run harness:core`.
- Uncommitted work in progress exists on the working tree (MCP connection command generation in `agentHandler.ts`, `AgentWorkspacePage.vue`, `mcpConnection.ts`, `build-mcp-server.mjs`). Treat it as intended direction; do not revert it.

## Phase 0 — Safety Net First (do before any refactor)

### 0.1 End-to-end harness case for the bundled MCP server

`res/mcp-agent-server.cjs` is the only artifact end users actually execute, and nothing validates it today (all tests exercise the in-process registry).

- Add a `harness:core` case that:
  1. Runs `npm run build:mcp` (or invokes `scripts/build-mcp-server.mjs` programmatically).
  2. Spawns `node res/mcp-agent-server.cjs --project <tmp fixture project>` as a child process.
  3. Performs `initialize` → `notifications/initialized` → `tools/list` → `tools/call` (`project.context_snapshot`) over stdin/stdout.
  4. Asserts: handshake returns a supported protocol version; tool list is non-empty; the call returns `isError: false` and valid JSON content.
- Must clean up the child process and tmp dir; must run on Windows and Linux CI.

### 0.2 Agent workspace page in the UI harness

`harness:ui` currently covers home, LLM settings, compare, and JSON verify — but not the agent workspace page, which is where regressions keep happening.

- Add a scenario to `src/harness/uiHarness.ts` + `scripts/harness/ui.cjs` that opens the `/agent-workspace` route and asserts stable `data-*` markers for: environment status list, MCP connection block, CLI preset cards, and the terminal surface/empty state.
- Follow the existing pattern: DOM text and `data-*` attributes only, no pixel assertions.

Acceptance: both new cases appear in the harness JSON artifacts with `status: passed`; `reproCommand` is populated and failed runs receive `failureHints`.

## Phase 1 — Kernel Correctness (boot side effects + permission tiers)

### 1.1 Side-effect-free construction

Current behavior: `new AgentService({ projectRoot })` → `WorkspaceService.ensureWorkspace()` creates 10 directories + 2 manifest files inside the user's game project, and `fs.mkdirSync(this.projectRoot, { recursive: true })` silently **creates** a wrong `--project` path instead of failing.

- `WorkspaceService`: validate that `projectRoot` exists and is a directory; throw a clear error otherwise. Never `mkdirSync` the project root itself.
- Make workspace materialization lazy: constructing `AgentService` must not write anything. Create `.llm-tsukuru-agent/` (and only the needed subdirectory) on first write. A `ensureWorkspaceMaterialized()` helper called by writing services is acceptable.
- `refreshManifest()` and manifest writes happen only after materialization or on explicit request.
- Update `mcpStdioServer.ts` accordingly: starting the server against a project must be a pure read until a tool actually writes.
- Update affected tests (`agentServiceCore`, `alignmentPatchKernel`, etc.) — they may currently assert eager directory creation.

### 1.2 Honest permission tiers

The "readonly" registry currently includes tools that write workspace state: `job.graph_create`, `workflow.save_recipe`, `workflow.compose` (if it persists), `glossary.propose_entries`, `repair.loop_run`, `repair.loop_stop`, and any `patch.propose` persistence.

- Reclassify every tool that writes under `.llm-tsukuru-agent/` as `workspace-write`. Audit each handler for filesystem writes; do not classify from names.
- `McpReadonlyToolRegistry.register` keeps rejecting non-readonly. Add `createMcpOfflineToolRegistry` so the stdio server exposes `readonly` + `workspace-write`, with MCP `annotations.readOnlyHint` set correctly per tool so CLI agents see the truth.
- `approval-required` and `dangerous` mutation tools stay unexposed. That is deliberate — see Phase 2.

### 1.3 Fix advertised-but-nonfunctional tools in the offline server

The stdio server builds its registry without app settings, so `settings.get_sanitized` and `provider.readiness` return placeholders, and `harness.latest` reads `artifacts/harness/` in the game project, which never exists there.

- Remove `settings.get_sanitized`, `provider.readiness`, and `harness.latest` from the offline server's tool list. They may remain available to in-process tests that provide real app context.
- Keep `provider.list`, and direct users to the app settings UI for actual readiness.

Acceptance: constructing `AgentService` against a read-only fixture directory leaves the directory byte-identical; a wrong `--project` path fails loudly; `tools/list` output tiers match actual filesystem behavior (add a test that runs every readonly-tier tool against a fixture and asserts no writes occurred).

## Phase 2 — Product Story Alignment (stop advertising the unwired flow)

The approval/apply machinery is not reachable by users or agents. Until it is wired, no surface may promise it.

- `src/renderer/agentWorkspaceModel.ts`:
  - Timeline: remove the `approval-gate` and `safe-apply` steps. They currently derive from `projectSelected && providerReady`, which is cosmetic.
  - `AGENT_COMMAND_PRESETS`: remove `safe-apply-plan`.
  - `DEFAULT_STARTER_PROMPTS`: rewrite so prompts only reference capabilities the project-protecting MCP server actually provides (context snapshot, inventory, quality review, alignment inspection, QA scoring). Remove instructions about "적용 미리보기와 승인" until apply exists.
- Update `src/agent/agentSkillGuide.ts`, `src/terminalCommandPresets.ts`, and `docs/AGENT_MCP_GUIDE.md` to remove unwired safe-apply, provider-readiness, and harness-latest claims. State that translation and apply happen in the app UI.
- Do not delete `approvalService`, `patchService.apply`, or `mutationTools` — they are tested infrastructure for the next milestone. Add a short note in this plan's Follow-ups when done.

Acceptance: grep the renderer and docs for 승인/적용/apply/approval claims; every remaining mention either describes the app UI's own apply flow or is explicitly marked as planned.

## Phase 3 — Renderer Single Source of Truth

`agentWorkspaceModel.ts` pre-creates placeholder sessions with fake ids (`'codex'`, `'claude'`, `'shell'`) while real sessions get `term-*` ids from `terminalService`. Reconciling the two models is the recurring regression source.

- Remove `createDefaultTerminalSessions` and placeholder session state. Both renderer session surfaces derive exclusively from main-process `terminalService.list()` results and session/terminal events over IPC.
- CLI presets remain as launch buttons (they are configuration, not sessions). After launch, the UI shows only the real session returned by `create()`.
- Keep exited, killed, and failed sessions visible until the app exits.
- Keep pure view-model helpers (`applyTerminalEvent`, labels) but they operate on real `TerminalSessionSummary` data only.
- Update `agentWorkspaceUiModel.test.ts` and the Phase 0.2 UI harness scenario to match.

Acceptance: no renderer code constructs a session object that did not originate from the main process; UI harness scenario still passes; manual smoke — launch/kill a PowerShell session and confirm states track reality.

## Phase 4 — Deduplication and Hygiene

Lower priority; safe to split into independent small PRs.

1. **JSON-RPC duplication**: make `protocolLight.ts` a thin wrapper over `handleMcpRequest` from `mcpStdioServer.ts`, or delete it and port its tests. One protocol implementation.
2. **Mocks out of production tree**: move `src/agent/mockAgents.ts` and `src/agent/mockMcp.ts` to `test/utils/` (or delete if unused). Update imports.
3. **Preset single source**: `AGENT_CLI_PRESETS` must derive entirely from `MANAGED_TERMINAL_PRESETS` (`terminalCommandPresets.ts`); remove duplicated executable/arg literals in the renderer model.
4. **Declare esbuild**: `scripts/build-mcp-server.mjs` depends on esbuild, which is only a transitive dependency of vite. Add it to `devDependencies` explicitly.
5. **Barrel trim**: `src/agent/index.ts` re-exports everything; keep only what external modules (`src/mcp/`, `src/ipc/`) genuinely import. Prefer direct imports elsewhere.
6. **Tool surface diet**: defer to a separate product decision. Do not remove tools in this plan.
7. **Generated artifact in git**: `artifacts/harness/harness-core.json` is tracked. Gitignore `artifacts/harness/` and remove the tracked file unless CI depends on it being committed (verify `.github/workflows/ci.yml` first — it uploads artifacts, it should not need them committed).

## Out of Scope (do not do in this plan)

- Wiring the mutation/approval flow end-to-end (next milestone; requires product decisions on the approval UX).
- Any change to the extract/translate/apply pipeline under `src/ts/`.
- New translation providers, provider settings UI changes.
- Live-provider harness changes.

## Follow-ups

- Keep the approval/apply kernel internal until a separate product milestone defines and wires the runtime approval UX.
- Decide any further MCP tool-surface reduction separately; this plan preserves the current help and analysis surface.
- Recheck the packaged Electron ConPTY warning after node-pty, Electron, or embedded Node upgrades, or immediately if a terminal child leak is observed; do not suppress it without preserving process-tree kill verification.

## Global Verification Checklist (every phase)

```bash
npm run lint
npx tsc -p tsconfig.main.json --noEmit
npm run test
npm run harness:core
npm run harness:eval
npm run harness:ui        # phases 0.2, 2, 3
npm run build:mcp         # phases 0.1, 1, 4.4
```

Plus per-phase acceptance criteria above. If a check cannot run in the current environment (e.g. Electron UI harness headless limits), say so explicitly in the handoff notes rather than skipping silently.

## Risks and Notes

- Phase 1.1 lazy materialization will break tests that assert eager directory creation — update the tests' expectations deliberately, not by re-adding eager writes.
- Phase 1.2 tier reclassification changes `tools/list` output; the Phase 0.1 e2e test pins the contract, update both together.
- Phase 3 touches the surface with the worst regression history; do it only after Phase 0.2 exists.
- Windows-first project: path comparisons are case-insensitive (`normalizeComparable`), keep that in mind for any path logic you touch.
