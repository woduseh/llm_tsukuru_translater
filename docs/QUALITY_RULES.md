# Quality Rules

Behavioral contracts for the affected code, not a mandatory verification sequence. See [HARNESS.md](HARNESS.md) for checks and [Architecture](ARCHITECTURE.md) for implementation locations.

## Structural Invariants

- Dialogue separators such as `--- 101 ---` must survive translation unchanged.
- Empty lines must stay empty.
- Per-block line counts must not drift unless a tool explicitly repairs them.
- RPG Maker control codes such as `\\V[1]`, `\\N[2]`, `\\C[3]`, `\\G`, `\\$`, `\\{`, and `\\}` must be preserved.
- BOM stripping and write behavior must stay consistent across read/write helpers.

## Translation Workflow Rules

- `Extract_backup` or `_backup` is the source of truth for untranslated content.
- `.llm_progress.json` and `.llm_cache.json` must remain resumable and safe to clear.
- `untranslated` mode must skip already translated files and re-run only files that still match backup.
- Cache/progress identity must include the effective provider configuration; cache keys also include content hash, model, source and target language. `translatorFactory.ts` and `providerRegistry.ts` define the fingerprints.
- Provider readiness errors must be deterministic and renderer-safe.
- Failed or incomplete provider output must not be saved, cached, or marked complete as a successful translation.

## File Mutation Rules

- Extraction/apply validates input structure and stages outputs before committing; failed multi-file commits roll back instead of reporting partial success.
- Existing translation backups are reusable only when their complete file set matches the extraction surface. `ext_javascript.js` belongs to the line-aligned translation surface too.
- Successfully decrypted Wolf archives remain recoverable as `.wolf.tsukuru-backup` files; leaving active `.wolf` archives can hide translated loose `Data/**` at runtime.
- JSON Verify writes are authorized by main-process validation of the active root, exact target/preimage and valid JSON immediately before atomic replacement. Renderer previews alone do not authorize a write.

## Verification Rules

- `verifyJsonIntegrity` must treat type drift, key drift, array length drift, and control-code drift as regressions.
- `repairJson` must preserve safe translated fields such as `displayName` while reverting invalid structural changes.
- Text-shift markers must be detected both when marker text is overwritten and when marker text leaks into dialogue.

## UI Rules

- Sub-windows must follow the existing ready-signal pattern before data is sent.
- Compare and verify views must expose enough stable state for automation to assert health.
- Settings and verify screens must never leak secrets into renderer-safe payloads.
- Approval previews must show every bounded material line change before an explicit per-request decision.

## Agent Bridge Rules

- The approval bridge must bind only to `127.0.0.1` and require bearer, app-session, bridge-session, and project-hash bindings.
- Bearer and confirmation tokens must never enter renderer state, copied command text, MCP results, logs, or audit metadata.
- The renderer file bridge must deny the protected rendezvous-manifest directory even though it can access other approved `userData` files.
- External MCP clients may submit proposals and read sanitized status only; they cannot approve, deny, or directly write project files.
- A missing, stale, cross-project, oversized, unauthenticated, or rate-limited bridge request must fail closed.
- App approval may execute only the exact project, path, source bytes, arguments, and preview that were bound to that one pending request.
- Approved writes must preserve UTF-8 BOM presence, every CRLF/LF separator, final-newline state, file mode where supported, separators, empty lines, control codes, and total line count.
- Post-write verification must compare exact expected bytes and restore the exact in-memory preimage atomically before reporting a recoverable verification failure.

## CI Rules

- Default PR CI must stay deterministic.
- Live-provider checks are opt-in and must record provider, model, and run date in artifacts.
- Harness results must be emitted as machine-readable JSON so a later agent can diagnose regressions.
