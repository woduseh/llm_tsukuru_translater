# Approval / Apply Runtime Integration — completed

Completed: 2026-07-29.

Historical implementation and verification record, not instructions for current work. Current contracts live in [Quality rules](../../QUALITY_RULES.md), [Architecture](../../ARCHITECTURE.md), and the [MCP guide](../../AGENT_MCP_GUIDE.md).

## Result

Connected external MCP patch proposals to an app-owned approval queue and byte-preserving executor. The formerly unwired approval kernel became a working submit → approve/deny → status flow.

- Electron main owns request state, selected-project/session binding, source and preview validation, one-time execution, and disposal on project changes.
- Agent Workspace displays complete bounded line previews and per-request approve/deny controls. A non-modal global pending banner provides navigation and keyboard focus to the request.
- A loopback HTTP bridge uses a rotating bearer and protected per-user rendezvous manifest. MCP commands pass the manifest path, without embedding the bearer. Submission and status routes cannot approve requests.
- Bridged MCP `patch.apply` submits a proposal; `approval.status` returns sanitized state. Without a live matching bridge, the offline server exposes analysis capabilities without project-writing execution.
- The executor revalidates the exact preimage, atomically replaces the file, verifies bytes and translation invariants, and restores original bytes atomically after verification failure.
- The implemented initial patch surface is one regular UTF-8 `.txt` file, bounded `replace-line` operations, and complete bounded previews. Backup/workspace targets, source drift, line-count changes, separator/empty-line changes, and control-code drift are rejected.
- Previews and approval details remain in session memory; persistent audit records contain metadata and hashes. UTF-8 BOM, newline style, final newline, and supported file mode are preserved.

## Recorded verification

Final checkpoint on 2026-07-29:

- TypeScript and lint passed (0 errors, 90 existing warnings); 566/566 unit tests passed.
- Focused executor/runtime/atomic-write tests passed 20/20, covering byte-preserving execution and restoration.
- Core harness passed 7/7, including real bundled stdio submission → app approval/application → applied status. The previous bridge checkpoint also verified submit → deny → status with a byte-identical target.
- Development UI and packaged Windows UI harnesses each passed 8/8, including explicit approval and exact CRLF/control-code preservation.
- Package configuration smoke passed 8/8; `git diff --check` passed.

Earlier focused contract, runtime, bridge, and IPC suites covered invalid payloads, path/session mismatch, replay, source drift, sanitization, idempotency, and queue limits. Intermediate checkpoints intentionally lacked an executor; those temporary states were resolved by the final checkpoint.

## Remaining scope at completion

No live-provider call or full translation E2E was run. The milestone implemented patch application only; it did not activate other mutation scaffolds or add persistent undo history. These describe delivered scope, not restrictions on future work.
