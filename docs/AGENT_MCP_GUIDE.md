# MCP Guide

This describes the app's game-project tools. Repository development instructions live in [AGENTS.md](../AGENTS.md).

## Capabilities

| Mode | Available work | Write behavior |
| --- | --- | --- |
| Offline stdio | Project inventory, structural review, alignment analysis, QA and analysis artifacts | Analysis state under `.llm-tsukuru-agent/`; no source-file mutation |
| App bridge (`--bridge-manifest`) | Offline tools plus `patch.apply` and `approval.status` | A proposal enters the app queue; the main process applies it only after the user approves that request in the app |

Tool registration does not prove the app bridge is still reachable. A missing or stale bridge returns a failure; it does not grant a fallback write path. Extraction, provider translation and full game-data apply run through the app UI.

`patch.apply` accepts bounded same-line replacements in one translated UTF-8 `.txt` file. It preserves line count, separators, empty lines and control codes; it cannot repair drift by inserting or deleting lines. `approval.status` reports a decision/result and cannot approve it. Contract limits and validation are implemented in `src/agent/mutationApprovalContracts.ts`.

## Choosing Tools

- `project.context_snapshot` and `project.translation_inventory`: locate inputs and backups.
- `quality.review_file`: structural findings without a persistent QA report; `qa.score_file`: durable QA output.
- `alignment.inspect` and `alignment.explain`: evidence for suspected alignment errors.
- `provider.list`: supported providers; actual credentials and readiness belong in app settings.

Use the evidence needed for the request; these are choices, not a mandatory sequence. Structural scores do not establish semantic translation quality. Relevant text excerpts can support meaning/tone review; credentials and bridge tokens must stay out of prompts, logs and results.

## Runtime Help

`help.translation_workflow`, `help.safe_recipe` and `help.explain_tool` expose concise guidance on demand. Their shared content is maintained in [agentSkillGuide.ts](../src/agent/agentSkillGuide.ts); bridge-specific dispatch is in [bridgeTools.ts](../src/mcp/bridgeTools.ts). Keep recipe details there rather than duplicating them in this document.
