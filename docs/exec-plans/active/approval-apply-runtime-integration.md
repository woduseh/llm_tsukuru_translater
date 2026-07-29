# Approval / Apply Runtime Integration Plan

Status: proposed
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

## Phase 0 — Contract and safety baseline

1. Document the proposal, approval, denial, expiry, execution, and failure states.
2. Define IPC/bridge schemas with `schemaVersion`, request ID, project/session binding, preview reference, affected paths, expiry, and status.
3. Add validation tests for malformed, cross-project, stale, replayed, and argument-mutated requests.
4. Record a byte-level fixture snapshot before every mutation test and assert that proposal/denial paths do not change project files.

Acceptance:

- No proposal or approval request writes game or translation files.
- Existing approval and security suites remain green.
- Invalid or stale requests fail closed with actionable messages.

## Phase 1 — App-owned mutation runtime

1. Construct one mutation registry in the Electron main process for the currently selected trusted project.
2. Bind its `AgentService` and `ApprovalService` to a per-app-session identifier.
3. Invalidate pending approvals when the selected project changes, the app session ends, or the preview no longer matches disk state.
4. Expose bounded proposal/list/get/deny operations over validated IPC.
5. Keep confirmation tokens in the main process; renderer and external agents receive opaque approval IDs only.

Acceptance:

- The renderer cannot call `patch.apply` with a forged token.
- Project switching invalidates pending requests.
- App shutdown leaves no reusable approval capability.

## Phase 2 — Preview and approval UI

1. Add an approval queue to the Agent Workspace.
2. Show tool name, project, exact relative paths, line-count invariant, before/after preview, request source, creation/expiry time, and audit status.
3. Require an explicit per-request approve or deny action. Do not add “always allow”.
4. Re-read the affected file and revalidate the preview immediately before approval.
5. Keep completed, denied, expired, and failed decisions visible for the app session.

Acceptance:

- The user can distinguish proposal, approval, execution, and failure states.
- A changed source file blocks approval and requests a fresh preview.
- Keyboard and screen-reader navigation cover the full decision flow.

## Phase 3 — Local agent bridge

1. Add an app-local authenticated endpoint for mutation proposals; reuse the existing local connection-command trust model where possible.
2. Return `needs-approval` with an opaque approval ID and status-query guidance.
3. Do not block a stdio request indefinitely while waiting for the user. Use submit → inspect status → retrieve result.
4. Scope the bridge token to the running app session and selected project.
5. Rate-limit and bound proposal payloads and preview sizes.

Acceptance:

- An external CLI can submit a dry-run proposal and observe approval status.
- It cannot approve its own request or reuse an approval across sessions/projects.
- The offline MCP server still cannot mutate files when the app bridge is unavailable.

## Phase 4 — Execute `patch.apply`

1. On approval, consume the main-process confirmation exactly once.
2. Revalidate path, original text, line count, separators, control codes, and preview hash.
3. Write atomically and emit a bounded audit event containing paths and hashes, not source text or secrets.
4. Report applied, denied, expired, stale, or failed outcomes to both UI and bridge clients.
5. Add recovery guidance; do not implement automatic retry after a stale or failed approval.

Acceptance:

- Approved same-line patches apply once.
- Separator, control-code, empty-line, or line-count regressions are rejected.
- Token replay, argument mutation, project changes, and source drift never write.

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
- source drift between preview and approval fails closed;
- app restart/project switch invalidates pending approvals;
- approved patch applies once and preserves all translation invariants;
- the packaged app completes the submit → approve/deny → status flow without a live provider.

## Open product decisions

- Where the approval queue should appear when the Agent Workspace is not open.
- Maximum preview size and the fallback UX for larger patches.
- Whether completed approval history persists beyond the app session; default recommendation is no until retention and privacy requirements are defined.
- Which mutation, if any, follows `patch.apply`.

## Stop conditions

- Do not expose any mutation tool externally until Phases 0–2 are green.
- Stop and request product direction if approval requires a persistent/global permission or if a preview cannot be bounded without hiding material changes.
- Do not combine this milestone with terminal improvements or MCP surface reduction.
