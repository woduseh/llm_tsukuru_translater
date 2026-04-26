# Agent Guide

This repository is the system of record for agent work. Start here, then follow the linked docs.

## Read First

- `readme.md`: product overview, local commands, project layout
- `docs/ARCHITECTURE.md`: main process, renderer, IPC, translation flows
- `docs/QUALITY_RULES.md`: invariants that must not regress
- `docs/HARNESS.md`: deterministic, eval, UI, and live harness entrypoints
- `docs/exec-plans/active/harness-engineering.md`: rollout status and accepted decisions

## Working Rules

- Do not break line-number alignment between extracted `.txt` files and `.extracteddata`.
- Preserve RPG Maker separators such as `--- 101 ---`, control codes, and empty lines.
- Treat the compare and verify windows as first-class quality surfaces, not optional tools.
- Prefer fixture-driven regression coverage over one-off manual validation.
- Keep live-provider checks opt-in; default CI must stay deterministic.
