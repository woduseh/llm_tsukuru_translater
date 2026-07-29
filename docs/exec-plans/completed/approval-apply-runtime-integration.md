# Approval / Apply Runtime Integration Plan

Status: complete
Updated: 2026-07-29 KST
Owner: 황재연 (product decisions and approval), executing agent (implementation)

## Goal

Connect the existing approval-gated mutation kernel to one real runtime path without weakening project-file protections or implying that an external CLI may apply changes without an explicit in-app user decision.

## Current state

- `ApprovalService` already binds confirmations to a session, tool name, exact argument hash, expiry, and one-time consumption.
- `createMcpMutationToolRegistry` already implements dry-run/approval behavior for `patch.apply` and other mutation scaffolds.
- `PatchService.apply` already rejects line-count changes and original-text mismatches.
- Unit and security tests cover token replay, expiry, session mismatch, argument mutation, and unapproved writes.
- The packaged offline MCP server intentionally exposes only read and analysis-workspace tools. No app runtime creates the mutation registry, surfaces approval requests, or returns a user decision to the pending call.

## Progress

- [x] Phase 0 — Contract and safety baseline
- [x] Phase 1 — App-owned mutation runtime
- [x] Phase 2 — Preview and approval UI
- [x] Phase 3 — Local agent bridge
- [x] Phase 4 — Execute `patch.apply`

Phase 0 verification (2026-07-29): added internal state-machine records, separate renderer/bridge DTOs, strict submit/list/get/approve/deny validators, patch/path/size/invariant bounds, safe public failure mapping, and byte-identical proposal/denial fixtures. `npm run typecheck`, focused approval/security tests (29/29), `npm run lint` (0 errors, 90 existing warnings), `npm test` (545/545), `npm run harness:core` (6/6), and `git diff --check` passed. No runtime, IPC, UI, bridge, or project-writing execution path was added.
Phase 1 verification (2026-07-29): added the app-owned `MutationApprovalRuntime`, metadata-and-hash-only audit mode, idempotency and pending/history limits, source-drift invalidation, one-way claim locking, project/app disposal, validated IPC/preload operations, and renderer-safe queue events. At the Phase 1 checkpoint, production approval remained pending with `execution-unavailable` because no executor was connected. Focused runtime/security/IPC tests (50/50), `npm run typecheck`, `npm run lint` (0 errors, 90 existing warnings), `npm test` (553/553), `npm run harness:core` (6/6), `npm run harness:ui` (6/6), and `git diff --check` passed.
Phase 2 verification (2026-07-29): added the full Agent Workspace approval queue, complete bounded line previews, explicit per-request approve/deny controls, proposal/approval/execution/result state separation, accessible request focus, and a global non-modal pending banner that deep-links to the selected request. At the Phase 2 checkpoint, approval revalidated source and preview state before reporting the intentionally missing executor, so drift became `stale` immediately without writing. Focused approval/runtime/IPC tests (39/39), `npm run typecheck`, `npm run lint` (0 errors, 90 existing warnings), `npm test` (553/553), `npm run harness:core` (6/6), `npm run harness:ui` (7/7, including pending-banner reachability and keyboard focus), and `git diff --check` passed.
Phase 3 verification (2026-07-29): added the app-owned `127.0.0.1` HTTP bridge, 256-bit rotating bearer, per-process protected rendezvous manifest, constant-time bearer/app/bridge/project binding checks, JSON/body/rate limits, and submit/status-only routes. The renderer file API rejects the whole manifest directory. MCP registration now passes only `--bridge-manifest`; the copied stdio bundle derives and verifies its project, adds proxy `patch.apply` and read-only `approval.status`, preserves per-process JSON-RPC idempotency, and fails closed without a live matching app. Focused bridge/runtime/MCP/IPC tests (56/56), `npm run typecheck`, `npm run lint` (0 errors, 90 existing warnings), `npm test` (560/560), `npm run harness:core` (7/7, including a real bundled stdio submit → deny → status round trip with byte-identical target), `npm run harness:ui` (7/7, including manifest commands without bearer exposure), default `npm run harness:package-smoke` (healthy scaffold, 8/8 checks, packaged-artifact launch not opted in), and `git diff --check` passed. At the Phase 3 checkpoint, approval still could not write because the Phase 4 executor had not been connected.
Phase 4 verification (2026-07-29): connected the default byte-preserving `patch.apply` executor, exact preimage revalidation, same-directory atomic replacement with original mode, byte/layout/invariant verification, and atomic preimage restoration after verification failure. Focused executor/runtime/atomic-write tests (20/20), `npm run typecheck`, `npm run lint` (0 errors, 90 existing warnings), `npm test` (566/566), `npm run harness:core` (7/7, including bundled stdio submit → app approve/apply → applied status), development `npm run harness:ui` (8/8), packaged Windows `npm run harness:ui` (8/8 with `executionMode: packaged`, including explicit UI approval and exact CRLF/control-code-preserving bytes), default `npm run harness:package-smoke` (healthy scaffold, 8/8 checks), and `git diff --check` passed. No live-provider call or full translation E2E was run.

## Scope

### In scope

- A local app-owned mutation runtime bound to the selected project and current app session.
- Preview-first `patch.apply` as the first end-to-end mutation.
- An in-app approval queue showing exact affected paths, bounded diff/preview, invariants, expiry, and approve/deny actions.
- One-time confirmation consumption, audit records, stale-request handling, and deterministic recovery.
- IPC contracts, renderer state, focused tests, and deterministic harness coverage.

### Out of scope

- Exposing `dangerous` tools.
- Silent or remembered approvals.
- Applying extraction, translation, or generated game data directly from an external CLI.
- Broad activation of every existing mutation scaffold.
- Provider calls, full translation E2E, and MCP tool-surface reduction.

## Accepted design direction

- The packaged offline MCP server remains project-protecting and does not receive a reusable write token.
- The Electron main process owns the mutation registry, approval state, and selected-project binding.
- External agents may submit a bounded mutation proposal through an app-local authenticated bridge, but only the app UI can approve or deny it.
- Approval is transaction-specific: project root, session, tool, arguments, preview hash, affected paths, and expiry must all still match at execution time.
- Approval returns no ambient capability. A consumed or denied confirmation cannot be replayed.
- Start with `patch.apply` only. Promote another mutation tool only after its own UX, invariants, and regression cases are defined.

## Locked v1 decisions

### Product and approval UX

- The full approval queue lives at the top of the Agent Workspace, directly below the page hero and before terminal/MCP controls.
- `App.vue` owns a non-modal global pending-approval banner and count badge so requests remain visible from Home, MV/MZ, and Wolf screens. Selecting the banner navigates to the Agent Workspace and focuses the request.
- A request never opens a blocking modal, steals focus, or approves on navigation. Approve and deny are explicit buttons on the expanded request card.
- Approval immediately attempts that one patch. There is no separate second “execute” click, remembered permission, bulk approval, or approve-all action.
- Denial needs no reason. An optional note is limited to 500 characters and is stored only in the in-memory session record.
- Pending requests expire after 15 minutes. Expired or stale requests cannot be revived; the agent must submit a fresh proposal.
- Terminal-state records remain visible until app exit. Full previews and optional denial notes are never restored after restart.

### State and public contracts

- Add an app-owned `MutationApprovalRecord` with these states:
  `pending`, `applying`, `applied`, `denied`, `expired`, `stale`, `failed`, and `cancelled`.
- Keep `ApprovalService` confirmation state internal. `ApprovalRequest.confirmToken`, absolute artifact paths, and main-process session IDs must never cross IPC or the local bridge.
- Renderer and bridge payloads use separate sanitized DTOs containing only opaque request/approval IDs, tool name, project label, relative affected paths, bounded preview, timestamps, status, invariant results, and safe failure guidance.
- A request is bound to schema version, app session, selected project canonical path, bridge session, tool, normalized arguments hash, source-content hash, preview hash, and expiry.
- A user approval is valid only while the record is `pending`. The main process performs a compare-and-set transition to `applying`, so double clicks and concurrent requests cannot execute twice.
- Terminal outcomes are immutable. Retrying `failed`, `stale`, `expired`, `denied`, or `cancelled` creates a new approval ID and re-runs preview validation.

### Proposal and preview bounds

- v1 accepts one regular UTF-8 `.txt` target file per request. The path must resolve inside the currently selected trusted project and outside `.llm-tsukuru-agent`, `Extract_backup`, and any `_backup` directory.
- The target file limit remains 256 KiB, matching `PatchService`.
- A proposal may contain at most 100 `replace-line` operations. `virtual-note` operations are not executable and are rejected by the approval bridge.
- The bridge accepts at most 256 KiB of JSON, each original/replacement line is limited to 8 KiB, and the complete rendered before/after preview is limited to 128 KiB.
- Oversized proposals are rejected before an approval record is created. The UI never hides or truncates material changes behind an approvable summary; the response tells the agent to split the patch.
- Duplicate line numbers, mixed target paths, newline-bearing replacements, separator changes, empty-line changes, control-code drift, and line-count changes fail closed before queue insertion.

### Local bridge

- Use a main-process HTTP server bound only to `127.0.0.1` on an OS-assigned port. Do not bind LAN interfaces and do not add a production dependency.
- Generate a 256-bit bearer token per app-session/project binding. Compare it in constant time and accept JSON requests only; do not enable browser CORS.
- Store the current port, token, app-session ID, project hash, schema version, and issuance time in a per-user rendezvous manifest under Electron `userData`, not in the game project. The token lives only for that app-session/project binding; use restrictive permissions where supported.
- The MCP registration command passes only `--bridge-manifest <path>`. The token is never embedded in the copied MCP bundle, command text, renderer state, logs, or audit records.
- Rotate the token and replace the manifest on project change. Remove the manifest on orderly shutdown; stale manifests still fail because the app-session handshake must match.
- The bridge exposes only:
  - `POST /v1/patch-apply`: validate and submit a proposal;
  - `GET /v1/approvals/:approvalId`: return sanitized status and the final result when terminal.
- The offline MCP adapter exposes `patch.apply` and read-only `approval.status`. `patch.apply` submits and returns `needs-approval`; it never accepts a confirmation token. `approval.status` cannot approve, deny, or mutate.
- Reuse the MCP connection's per-process session ID plus JSON-RPC request ID as the idempotency key. Repeated identical submissions return the existing record; reusing a key with different arguments is rejected.
- Limit submission to 10 requests per minute per bridge token, 20 concurrent pending requests, and 100 in-memory history records per app session.

### Storage, audit, and recovery

- Keep proposal arguments, previews, confirmation tokens, denial notes, and results in main-process memory only.
- Persist append-only audit metadata under `.llm-tsukuru-agent/audit`: timestamp, action, status, opaque IDs, tool, relative paths, and hashes. Do not persist source/replacement text, bearer tokens, confirmation tokens, absolute paths, or denial notes.
- Do not use the existing disk-backed approval preview artifact in this runtime path. The app runtime uses `ApprovalService` plus the dedicated mutation validator/executor and returns sanitized views.
- There is no persistent undo history in v1. The approval card states that an approved patch directly edits the named file.
- During execution, retain the original bytes in memory. Write through the existing same-directory atomic-file utility, re-read and verify the result, and restore the original bytes atomically if post-write verification fails.
- Preserve UTF-8 BOM presence, CRLF/LF style, final-newline state, file mode where supported, separators, empty lines, control codes, and total line count.

### Scope and rollout

- No mutation follows `patch.apply` in this milestone. Selecting a second mutation requires a new plan after real usage and audit evidence.
- Do not add background provider calls, full translation/apply execution, persistent approvals, or MCP surface diet.
- The feature is ready to ship only after a packaged Windows submit → approve/deny → status smoke passes. Live-provider and full translation E2E remain out of scope.

## Phase 0 — Contract and safety baseline

1. Add the internal `MutationApprovalRecord` state machine and separate sanitized IPC/bridge DTOs.
2. Define validated IPC and HTTP schemas for submit, list, get, approve, and deny operations.
3. Add the v1 path, payload, operation-count, line-size, preview-size, and idempotency bounds.
4. Add validation tests for malformed, oversized, cross-project, stale, replayed, duplicate-line, mixed-target, and argument-mutated requests.
5. Record a byte-level fixture snapshot before every mutation test and assert that proposal/denial paths do not change project files.

Acceptance:

- No proposal or approval request writes game or translation files.
- No serialized renderer or bridge payload contains a confirmation token, bearer token, absolute artifact path, or source text outside the bounded preview.
- Existing approval and security suites remain green.
- Invalid or stale requests fail closed with actionable messages.

## Phase 1 — App-owned mutation runtime

1. Add a `MutationApprovalRuntime` coordinator owned by `AppContext`.
2. Construct one `AgentService`/`ApprovalService` binding for the currently selected trusted project and app-session ID.
3. Hook the existing `rememberTrustedProjectPaths` transition so a project change cancels pending requests, rotates the bridge session, and disposes the previous runtime.
4. Expose bounded list/get/approve/deny operations over validated IPC and emit `approvalQueueChanged` snapshots.
5. Keep confirmation tokens and unsanitized patch arguments inside the coordinator.

Acceptance:

- The renderer cannot call `patch.apply` with a forged token.
- Project switching invalidates pending requests.
- App shutdown leaves no reusable approval capability.
- Concurrent approval attempts execute at most once.

## Phase 2 — Preview and approval UI

1. Add the full-width approval queue to the Agent Workspace and the global non-modal pending banner/badge to `App.vue`.
2. Show tool name, project label, exact relative path, operation count, invariant results, complete bounded before/after preview, request source, creation/expiry time, and audit status.
3. Require an explicit per-request approve or deny action. Do not add “always allow”, bulk actions, or approval from notifications.
4. Refresh and revalidate the preview in the main process immediately before approval.
5. Keep terminal states visible for the app session and support keyboard/screen-reader navigation.

Acceptance:

- The user can distinguish proposal, approval, execution, and failure states.
- A changed source file blocks approval and requests a fresh preview.
- Keyboard and screen-reader navigation cover the full decision flow.
- A pending request is visible and reachable when the Agent Workspace is not the active route.

## Phase 3 — Local agent bridge

1. Add the loopback HTTP server, rotating bearer token, and per-user rendezvous manifest.
2. Update MCP connection commands and the stdio adapter to discover the live bridge through `--bridge-manifest`.
3. Expose only proxy `patch.apply` and read-only `approval.status`; return `needs-approval` with an opaque approval ID and polling guidance.
4. Do not block a stdio request while waiting for the user. Status responses include the final sanitized result when terminal.
5. Enforce authentication, session/project binding, idempotency, rate, pending-count, body, and preview limits before queue insertion.

Acceptance:

- An external CLI can submit a dry-run proposal and observe approval status.
- It cannot approve its own request or reuse an approval across sessions/projects.
- The offline MCP server still cannot mutate files when the app bridge is unavailable.

## Phase 4 — Execute `patch.apply`

1. Atomically claim a pending request and revalidate project binding, path, source hash, original text, line count, empty lines, separators, control codes, and preview hash.
2. Consume the internal confirmation exactly once and perform the write through `atomicWriteTextFile`.
3. Re-read the target, verify expected bytes and invariants, and atomically restore the in-memory preimage if verification fails.
4. Emit bounded audit metadata containing relative paths and hashes, not source/replacement text or secrets.
5. Report applied, denied, expired, stale, failed, or cancelled outcomes to UI and bridge clients without automatic retry.

Acceptance:

- Approved same-line patches apply once.
- Separator, control-code, empty-line, or line-count regressions are rejected.
- Token replay, argument mutation, project changes, and source drift never write.
- BOM, newline style, final-newline state, and file mode are preserved.
- A post-write verification failure restores the exact original bytes.

## Implementation map

- `src/types/agentWorkspace.ts`: internal/public approval contracts and validation enums.
- `src/agent/approvalService.ts`: internal token lifecycle only; add safe enumeration/invalidation helpers as needed.
- `src/agent/mutationApprovalRuntime.ts`: state machine, bounds, sanitization, idempotency, audit, execution coordination.
- `src/agent/mutationApprovalContracts.ts`, `src/agent/patchService.ts`: proposal bounds, executable-operation validation, source/preview hashes, and translation invariants.
- `src/agent/mutationPatchExecutor.ts`, `src/ts/libs/atomicFile.ts`: atomic byte-preserving apply, post-write verification, file-mode preservation, and exact preimage restoration.
- `src/appContext.ts`, `src/ipc/windowManager.ts`, `main.ts`: runtime and bridge lifecycle.
- `src/ipc/agentHandler.ts`, `src/types/ipc.ts`, `src/preload.ts`: sanitized IPC methods and queue events.
- `src/agent/agentBridgeServer.ts`, `src/agent/mcpConnection.ts`, `src/mcp/mcpStdioServer.ts`: loopback bridge and MCP proxy tools.
- `src/renderer/App.vue`, `src/renderer/views/AgentWorkspacePage.vue`, focused components/composables: pending indicator and approval queue.
- `test/unit/`, `src/harness/uiHarness.ts`, `scripts/harness/`: contract, security, UI, and packaged-flow coverage.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run harness:core
npm run harness:ui
npm run harness:package-smoke
```

Add focused cases for:

- proposal and denial leave the project byte-identical;
- approval token never crosses into renderer-visible state;
- bearer token and absolute paths never appear in commands, logs, IPC, MCP results, or audit files;
- source drift between preview and approval fails closed;
- app restart/project switch invalidates pending approvals;
- duplicate/replayed approval and idempotency races apply at most once;
- oversized, mixed-target, backup-path, and virtual-note proposals never enter the queue;
- approved patch applies once and preserves all translation invariants;
- post-write verification failure restores the exact preimage;
- the packaged app completes the submit → approve/deny → status flow without a live provider.

## Resolved product decisions

- Queue visibility outside Agent Workspace: global non-modal banner/count with navigation, never modal approval.
- Preview limit: complete preview up to 128 KiB; reject and split above the limit.
- Completed history: in-memory for the app session only; persistent audit contains metadata and hashes only.
- Next mutation after `patch.apply`: none in this milestone.

No product decision remains blocking for Phase 0. Revisit these choices only if implementation proves that a bound cannot be enforced without hiding material changes or weakening the project trust boundary.

## Stop conditions

- Do not expose any mutation tool externally until Phases 0–2 are green.
- Stop and request product direction if approval requires a persistent/global permission or if a preview cannot be bounded without hiding material changes.
- Do not combine this milestone with terminal improvements or MCP surface reduction.
