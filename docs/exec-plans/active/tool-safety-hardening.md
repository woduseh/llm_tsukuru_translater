# Tool safety hardening progress

Updated: 2026-08-25 14:29 +09:00

## Goal

Wolf, LLM, agent/MCP, MV/MZ extraction/apply, compare, and verify tools must fail closed without silently losing edits or reporting incomplete work as successful.

## Current state

- Done: LLM provider failures now propagate; failed files are not written, cached, or marked complete.
- Done: bulk and targeted retranslation use configuration-scoped cache/progress, current provider defaults, directory locking, request identity, and preimage checks.
- Done: compare recognizes Wolf command-index separators, JavaScript extraction output, dirty-file navigation, empty-line drift, and ordered control-code drift.
- Done: Wolf extraction/apply uses project-scoped paths, staged extraction, encoding checks, stale-source checks, and rollback-capable multi-file commit.
- Done: MV/MZ extraction stashes text, metadata, translation backup, and requested media artifacts; YAML/temp JSON collisions fail closed and temporary files are cleaned up.
- Done: MV/MZ apply validates metadata ranges and text structure, stages every output, propagates CSV/media errors, and transactionally commits instant-apply output.
- Done: agent terminal secrets are stream-redacted, completed sessions are bounded, decrypted Wolf projects are detected, and MCP request/schema errors are hardened.
- Done: MV/MZ font replacement updates the actual MV CSS or MZ System.json font reference.
- Done: successfully decrypted Wolf archives are moved to recoverable `.tsukuru-backup` names so they cannot shadow loose translated `Data/**`; collisions and partial moves fail closed and roll back.
- Done: every JSON Verify mutation uses a main-process IPC that validates the active verify root and file identity, rejects stale preimages, validates JSON, and atomically replaces the target.

## Decisions

- Provider/API fallback text must never be persisted as a successful translation.
- User-visible data mutation uses preflight validation, staging, and rollback where practical.
- A pre-existing translation backup is accepted only when its complete file set matches the current extraction surface.
- JavaScript strings extracted to `ext_javascript.js` are part of the same line-aligned translation surface as `.txt` files.
- Decrypted Wolf archives remain recoverable, but must not retain a `.wolf` extension after successful extraction because the runtime can prioritize them over loose `Data/**`.
- JSON Verify renderer results are advisory until the main process accepts the exact request, target, and preimage immediately before atomic replacement.

## Changes and validation

- Validated: `npm run typecheck` passed.
- Validated: focused Wolf/Verify/safety regression suite passed, 3 files and 31 tests.
- Validated: `npm test` passed, 56 files and 629 tests.
- Validated: `npm run build:app` passed for renderer, main TypeScript, and MCP bundle; Vite retains the existing >500 kB chunk warning.
- Validated: `npm run lint` passed with 0 errors and 87 existing warnings.
- Previously validated in this work: core harness 7/7, eval harness 6/6, and package configuration smoke 8 checks.
- Not validated: a real Wolf game/wolfdec run, live LLM providers, UI E2E, or a packaged installer artifact.

## Remaining limits

1. The deterministic suite covers archive backup collision and rollback, but a real Wolf title is still needed to confirm the bundled `wolfdec` output and runtime behavior end to end.
2. JSON Verify IPC and pure write-path tests cover path escape, invalid JSON, and stale preimages. The actual Electron window interaction has not been exercised by UI E2E.
3. Live provider behavior, packaged installer behavior, and platform-specific antivirus/file-lock interference remain outside deterministic coverage.

## Next

1. Run the smallest real Wolf fixture/game smoke: decrypt, confirm `.wolf.tsukuru-backup` recovery files, translate/apply, launch, and verify the loose `Data/**` translation is loaded.
2. Exercise JSON Verify in the Electron UI for selected revert, current/all auto-repair, LLM preview/apply, and an intentional external-edit race.
3. Before release, run the opt-in live-provider checks and packaged installer smoke; no further deterministic P1/P2 implementation item is currently known.
