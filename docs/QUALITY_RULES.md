# Quality Rules

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
- Cache keys must include provider, content hash, model, and target language.
- Provider readiness errors must be deterministic and renderer-safe.

## Verification Rules

- `verifyJsonIntegrity` must treat type drift, key drift, array length drift, and control-code drift as regressions.
- `repairJson` must preserve safe translated fields such as `displayName` while reverting invalid structural changes.
- Text-shift markers must be detected both when marker text is overwritten and when marker text leaks into dialogue.

## UI Rules

- Sub-windows must follow the existing ready-signal pattern before data is sent.
- Compare and verify views must expose enough stable state for automation to assert health.
- Settings and verify screens must never leak secrets into renderer-safe payloads.

## CI Rules

- Default PR CI must stay deterministic.
- Live-provider checks are opt-in and must record provider, model, and run date in artifacts.
- Harness results must be emitted as machine-readable JSON so a later agent can diagnose regressions.
