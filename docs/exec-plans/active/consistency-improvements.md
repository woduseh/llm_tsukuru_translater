# Consistency Improvements Progress

Updated: 2026-07-29 KST

## Goal

- Align source, deterministic harnesses, CI, packaging assets, and project documentation.

## Scope

- In scope: UI/package harness assertions, Vue quality gates, renderer font assets, README/architecture/harness docs.
- Out of scope: provider behavior changes, version bumps, changelog edits, live-provider calls, release publishing.

## Current state

- Done: phases 1–4 implementation and full deterministic validation.
- Partial: none.
- Not started: none.
- Blocked: none.

## Decisions

- Strengthen regression detection before correcting implementation and docs.
- Keep live-provider and real installer execution opt-in.
- Use the Windows system Korean font stack instead of adding a new bundled font binary.

## Files and areas

- Changed: harness/CI, Vue quality configuration, renderer font CSS, README and internal architecture/harness guidance.
- Likely next: validation only.

## Validation

- Baseline: 529 unit tests, core 6/6, eval 6/6, UI 6/6; lint has 84 warnings and no errors.
- Phase 1: main TypeScript check, package smoke, and UI harness 6/6 passed.
- Phase 2: combined main/renderer typecheck and Vue-aware lint passed; lint now reports 90 warnings and no errors.
- Phase 3: renderer build and package smoke passed; the unresolved NotoSansKR warning is gone.
- Final: 529 unit tests, core 6/6, eval 6/6 (score 100), UI 6/6, and package smoke 8/8 checks passed.
- Not run: live-provider harness, real ZIP/NSIS build, packaged-app launch smoke.

## Next steps

1. Review and commit the completed changes when requested.
2. Run live-provider or packaged-app checks only as an explicit opt-in.
