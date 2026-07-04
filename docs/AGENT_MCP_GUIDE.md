# Agent MCP Guide

The offline MCP server protects game and translation source files. It may write bounded analysis artifacts under `.llm-tsukuru-agent/`, but it does not expose translation or apply execution. Run those actions through the app UI.

## Safety invariants

- Keep MCP writes under `.llm-tsukuru-agent/`.
- Never dump full source files, translated scripts, credentials, or provider secrets into prompts, logs, MCP responses, or terminal output.
- Preserve `.txt` line-number alignment with `.extracteddata` metadata.
- Preserve RPG Maker separators such as `--- 101 ---`, control codes, escape sequences, and intentional empty lines.
- Use the app UI for extraction, translation, comparison, verification, and apply actions.

## Recipes

### Translation preflight

1. Use `project.context_snapshot` and `project.translation_inventory` to inspect project state without returning file contents.
2. Use `provider.list` to review supported providers.
3. Configure credentials and confirm readiness in the app settings UI.
4. Run extraction and a small translation batch in the app.
5. Review representative results with `quality.review_file` or `qa.score_file`.

### Quality review

1. Locate candidate translated `.txt` files with `project.translation_inventory`.
2. Use `quality.review_file` for a non-persistent structural review.
3. Use `qa.score_file` when a durable QA artifact in `.llm-tsukuru-agent/` is useful.
4. Use the compare window for human review of meaning, tone, placeholders, and omissions.

### Line-shift diagnosis

1. Use `quality.review_file` to find separator, empty-line, and control-code anomalies.
2. Use `alignment.inspect` or `alignment.explain` for bounded alignment artifacts.
3. Summarize affected lines without modifying source or translated files.
4. Continue review in the app compare and verification surfaces.

### Failed translation recovery

1. Inspect `project.context_snapshot` and `project.translation_inventory`.
2. Review only representative failed files with `quality.review_file`.
3. Check provider configuration in the app settings UI.
4. Retry only the failed batch from the app when possible.

### Provider setup

1. Use `provider.list` to choose a supported provider and model.
2. Enter credentials only in the app settings UI.
3. Confirm readiness in the app UI.
4. Run a small app translation sample before starting a large batch.
