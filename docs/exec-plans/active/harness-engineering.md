# Harness Engineering Rollout

## Current Shape

This rollout adds a repo-native harness stack without introducing a second test framework for core behavior.

- agent-facing docs live under `AGENTS.md` and `docs/`
- deterministic harness runners live under `scripts/harness/`
- curated corpora and UI fixtures live under `test/fixtures/harness/`
- Electron smoke automation is implemented inside the app runtime, then driven by `harness:ui`

## Accepted Decisions

- Deterministic CI remains the default gate.
- Live provider checks are manual or opt-in.
- UI harness uses DOM snapshots and real app windows instead of screenshot diffing.
- Harness runners emit JSON summaries that can be consumed by later agents or CI artifacts.

## Follow-up Debt

- Expand the eval corpus as new translation regressions appear in real projects.
- Add more UI scenarios once additional sub-window flows need protection.
- Consider promoting the live harness to scheduled nightly runs once secret management and cost expectations are settled.
