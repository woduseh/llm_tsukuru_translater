# Harness Engineering — completed

Historical rollout record, not instructions for current work. Current commands and coverage are in [Harness](../../HARNESS.md).

The repository gained deterministic runners under `scripts/harness/`, curated corpora and UI fixtures under `test/fixtures/harness/`, and Electron smoke automation driven through the app runtime. JSON summaries support CI artifacts and regression diagnosis. UI checks use DOM state and real app windows rather than screenshot diffs.

Deterministic CI remained the default; live-provider checks stayed opt-in. Subsequent verification is recorded in [Consistency Improvements](consistency-improvements.md) and the other completed milestones.

Corpus growth and additional sub-window scenarios are ongoing maintenance opportunities as concrete regressions appear. Scheduled live-provider runs were considered but were not implemented by this rollout.
