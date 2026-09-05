# Tool hardening — outstanding validation

Implementation and deterministic checks completed at the 2026-08-25 checkpoint. This record tracks remaining evidence gaps; it does not prescribe a workflow for unrelated changes. Current behavioral contracts are in [Quality rules](../../QUALITY_RULES.md).

## Implemented

- Provider failures propagate without saving, caching, or completing failed translations. Bulk and targeted retranslation use scoped progress/cache, locking, request identity, and preimage validation.
- Compare handles Wolf separators, JavaScript extraction, dirty navigation, empty-line drift, and ordered control-code drift.
- Wolf extraction/apply uses scoped paths, staging, encoding/source checks, and rollback. Successfully decrypted archives are moved to recoverable `.wolf.tsukuru-backup` files so they cannot shadow translated loose data.
- MV/MZ extraction preserves text, metadata, translation backups, and requested media; apply validates structure, stages outputs, propagates errors, and commits instant-apply output transactionally. Font replacement updates the actual MV CSS or MZ font reference.
- Terminal/MCP handling includes streamed secret redaction, bounded completed sessions, decrypted Wolf detection, and request/schema validation.
- JSON Verify mutations validate root, target identity, preimage, and JSON in main-process IPC before atomic replacement.

## Recorded verification

Typecheck, app build, lint (0 errors, 87 existing warnings), and 629 tests across 56 files passed. Focused Wolf/Verify/safety tests passed 31/31. Earlier checks in this work passed core 7/7, eval 6/6, and package configuration smoke 8/8. The existing Vite >500 kB chunk warning remained.

## Remaining evidence gaps

- **Real Wolf runtime:** deterministic tests cover archive collisions and rollback, but a real game/wolfdec run has not confirmed decryption, recoverable archive naming, translation/apply, and runtime loading from loose `Data/**` end to end.
- **External/runtime conditions:** live providers, the installer artifact, and antivirus/file-lock interference were not validated by this work. Earlier packaged approval/terminal checks in completed milestones do not close these specific gaps.

No additional deterministic P1/P2 implementation defect was known at that checkpoint. Live-provider and packaged checks remain opt-in; relevant commands are in [Harness](../../HARNESS.md).
