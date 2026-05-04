# Agent MCP Guide

This guide is the product-facing scaffold for safe agent-assisted translation. It is intentionally read-only by default: agents may inspect bounded metadata, offer command previews, and draft starter prompts, but they must not run destructive commands or apply changes without an explicit preview and approval step.

## Safety invariants

- Preview before any run, apply, overwrite, or destructive operation.
- Never dump full source files, translated scripts, credentials, or provider secrets into prompts, logs, MCP responses, or terminal output.
- Preserve `.txt` line-number alignment with `.extracteddata` metadata.
- Preserve RPG Maker separators such as `--- 101 ---`, control codes, escape sequences, and intentional empty lines.
- Use read-only MCP context first; require explicit approval before future write or execute actions.

## Recipes

### First translation

1. Use `project.context_snapshot` and `project.translation_inventory` to understand project state without file contents.
2. Check `provider.readiness`; if the provider is not ready, open settings instead of retrying blindly.
3. Run extraction in the app UI and verify generated `.txt` and `.extracteddata` counts.
4. Translate a small batch first.
5. Use `quality.review_file`, the compare window, and an apply preview before approving writes.

### Quality review

1. Locate candidate translated `.txt` files with `project.translation_inventory`.
2. Use `quality.review_file` for separator, blank-line, and control-code invariants.
3. Use the compare window for human review of meaning, tone, placeholders, and omissions.
4. Record bounded summaries only; do not paste whole files.

### Safe apply

1. Confirm translated text and matching `.extracteddata` are present.
2. Review `project.get_quality_rules` and recent `harness.latest` results.
3. Generate a preview artifact listing target files and expected write scope.
4. Ask for explicit approval after preview review.
5. Verify results after apply before packaging changes.

### Line-shift repair

1. Use `quality.review_file` to find separator, empty-line, and control-code anomalies.
2. Compare nearby separators and line counts against original extracted text.
3. Restore deleted blank lines and separators before changing wording.
4. Keep every metadata-bound text span on its original line range.
5. Re-run review and compare before applying.

### Failed translation recovery

1. Inspect bounded failure summaries and `harness.latest`.
2. Use `provider.readiness` to separate configuration issues from transient failures.
3. Retry only the failed batch when possible.
4. Preserve already verified output and keep secrets redacted.

### Provider setup

1. Use `provider.list` to choose a supported provider and model.
2. Enter credentials only in the app settings UI.
3. Use `provider.readiness` to check sanitized readiness.
4. Run a small sample before starting a large batch.

