# Codex Guide

Electron + Vue desktop translator for RPG Maker MV/MZ and Wolf RPG Editor. This is the repository's single coding-agent entry point.

- Preserve extracted text line-number alignment with `.extracteddata`, separators, control codes, and intentional empty lines. These determine where translations are applied.
- Choose implementation and verification to match the change. Add regression coverage for changed behavior; stop once relevant checks pass unless new evidence warrants more work. Default tests/CI use fixtures and mocks; live providers are opt-in.
- The app's game-project MCP approval rules describe product behavior, not permission requirements for editing this repository.

Read references as needed for the affected area; no full-document reading sequence is required:

- [README](readme.md): setup, commands, product overview.
- [Architecture](docs/ARCHITECTURE.md): code map, IPC and extraction formats.
- [Quality contracts](docs/QUALITY_RULES.md): translation, file integrity and approval behavior.
- [Harness](docs/HARNESS.md): choose and run relevant checks.
- [MCP guide](docs/AGENT_MCP_GUIDE.md): app-facing tool capabilities and guidance source.

`docs/exec-plans/active/` records unresolved work, not automatic assignments. Completed plans are historical evidence, not current instructions.
