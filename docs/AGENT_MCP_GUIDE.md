# MCP Guide

This describes the app's game-project tools. Repository development instructions live in [AGENTS.md](../AGENTS.md).

## Capabilities

| Mode | Available work | Write behavior |
| --- | --- | --- |
| Offline stdio | Project inventory, structural review, alignment analysis, QA and analysis artifacts | Analysis state under `.llm-tsukuru-agent/`; no source-file mutation |
| App bridge (`--bridge-manifest`) | Offline tools plus `bridge.status`, `patch.apply` and `approval.status` | A proposal enters the app queue; the main process applies it only after the user approves that request in the app |

Tool registration does not prove the app bridge is still reachable. Use `bridge.status` before submitting work to check the current connection. A missing or stale bridge returns a failure; it does not grant a fallback write path. Extraction, provider translation and full game-data apply run through the app UI.

`patch.apply` accepts bounded same-line replacements in one translated UTF-8 `.txt` file: at most 256 KiB per file, 100 operations, and 8 KiB per original/replacement line. It preserves line count, separators, empty lines and control codes; it cannot repair drift by inserting or deleting lines. Proposal validation uses the same current-file and invariant validator as approval submission. A valid proposal still requires app approval and can become stale before submission or execution. `approval.status` reports a decision/result and cannot approve it. Contract limits and validation are implemented in `src/agent/mutationApprovalContracts.ts`.

## Public Tool Surface

The stdio registry exposes 16 offline tools, or 19 with the app bridge. [agentTools.ts](../src/mcp/agentTools.ts) defines the curated surface and explicit argument schemas.

| Task | Tools |
| --- | --- |
| Discover project files and rules | `project.context_snapshot`, `project.translation_inventory`, `project.get_quality_rules` |
| Read complete physical lines or find repeated text | `translation.read_window`, `translation.search` |
| Inspect a source/translation pair | `alignment.inspect`, `qa.score_file` |
| Prepare a patch and validate an existing patch | `patch.propose`, `patch.validate` |
| Page through saved findings | `artifacts.read_ref` |
| Look up terminology or existing memory | `glossary.search`, `memory.search` |
| Discover provider types | `provider.list` |
| Get workflow and input guidance | `help.translation_workflow`, `help.safe_recipe`, `help.explain_tool` |
| Check connection, submit approval and read its result | `bridge.status`, `patch.apply`, `approval.status` (bridge only) |

The former `alignment.find_breaks/score/explain`, QA explanation/gate wrappers, standalone `patch.preview`, and `quality.review_file` are not registered in the public stdio surface. Their useful results are included in inspection or proposal responses. `job.graph_*`, `workflow.*` and `repair.loop_*` planning/simulation services also remain internal; their existence does not imply actual translation or repair execution through MCP. Existing clients must migrate to the public tools above.

## Working From Evidence

1. Discover paths with the project tools. File names alone do not prove source/translation pairing.
2. Inspect a known pair with `alignment.inspect` or `qa.score_file`. These return coverage, compact findings and a saved result reference. Partial file coverage blocks a passing gate; a structural score is not a semantic quality rating (`semanticQuality: "not-evaluated"`).
3. Read the affected text with `translation.read_window`, optionally supplying `sourcePath`. The default is 40 complete lines, including empty lines, separators and control codes, with one-based physical line numbers and file hashes. Matching positions alone do not prove semantic alignment. Files over 8 MiB are rejected; oversized responses must be retried with a smaller window. Do not use redacted text as an exact patch precondition.
4. For repeated terms, call `translation.search` with known `paths` and a literal, case-sensitive `query`. Follow its `next` arguments to continue; use `read_window` for surrounding context.
5. Submit intended replacements to `patch.propose` using `targetPath` and an `operations` array. Every operation requires `lineNumber`, exact current `originalText`, and complete `replacementText`. The response includes the patch, validation and before/after preview. No source file is changed.
6. With a reachable app bridge, submit the returned `patch` object to `patch.apply`. An optional `idempotencyKey` can identify one logical submission across retries. Retain that key when retrying an uncertain response. Read `approval.status` with the returned approval ID; pending approval is not completion. Re-read and regenerate stale proposals, and reinspect after an applied result.

For example, a same-line proposal has this input shape:

```json
{
  "targetPath": "Translated/Map001.txt",
  "operations": [
    { "lineNumber": 2, "originalText": "Hello \\V[1]", "replacementText": "안녕 \\V[1]" }
  ]
}
```

`artifacts.read_ref` accepts `refId`, `collection` (`summary`, `refs`, `breaks`, `findings` or `operations`), zero-based `offset`, and `limit`. Follow `nextOffset`; byte limits can make a page shorter than requested. Responses are valid JSON pages rather than clipped JSON strings. Reuse the saved inspection when reading more findings instead of rerunning it.

Use the evidence needed for the request; this workflow is guidance, not a mandatory sequence. Meaning and tone still require review of the actual text. Provider credentials/readiness belong in app settings; credentials and bridge tokens must stay out of prompts, logs and results. The tool surface follows the [OpenAI function-calling design guidance](https://developers.openai.com/api/docs/guides/function-calling#best-practices-for-defining-functions): explicit arguments, clear task boundaries and combined operations that are normally used together. Model-specific task success still needs a live agent evaluation.

## Runtime Help

`help.translation_workflow`, `help.safe_recipe` and `help.explain_tool` expose concise guidance on demand. Their shared content is maintained in [agentSkillGuide.ts](../src/agent/agentSkillGuide.ts); bridge-specific dispatch is in [bridgeTools.ts](../src/mcp/bridgeTools.ts). Keep recipe details there rather than duplicating them in this document.
