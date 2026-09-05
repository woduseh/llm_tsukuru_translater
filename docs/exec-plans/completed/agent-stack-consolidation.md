# Agent Stack Consolidation — completed

Completed: 2026-07-04; terminal follow-up verified 2026-07-29.

Historical implementation record, not instructions for current work. Current runtime behavior is described in [Architecture](../../ARCHITECTURE.md) and [MCP guide](../../AGENT_MCP_GUIDE.md).

## Result

The external CLI, bundled MCP server, and in-app terminal became one tested usage path. Previously, the UI advertised an approval/apply flow that had no runtime connection, MCP construction wrote to projects, and renderer terminal placeholders diverged from real sessions.

- Agent construction became side-effect-free; analysis workspace creation became lazy and invalid project roots failed instead of being created.
- The offline registry separated read-only tools from analysis-state writes under `.llm-tsukuru-agent/`, with accurate permission annotations. App-only settings/readiness/harness tools were excluded from the offline surface.
- The bundle became `res/mcp-agent-server.cjs`; bundled stdio handshake and Agent Workspace coverage were added to deterministic harnesses.
- Renderer terminal lists began using main-process session summaries. CLI presets were consolidated, protocol handling deduplicated, test mocks moved out of production, and generated harness artifacts excluded from Git.
- Unwired approval/apply claims were removed at this milestone. The retained mutation kernel was subsequently connected by [Approval / Apply Runtime Integration](approval-apply-runtime-integration.md); the old restriction on advertising that flow is no longer current.
- Terminal editing later preserved bounded safe VT sequences for PSReadLine while filtering unsafe terminal commands, redacting secrets, and keeping plain-text transcripts.

## Recorded verification

- Consolidation: TypeScript and lint passed (0 errors, 84 existing warnings); 529 unit tests; MCP build; core 6/6, eval 6/6 (score 100), and UI 6/6, including Agent Workspace. The bundled MCP handshake reported 47 tools at that checkpoint.
- Packaged v3.2.0 Windows ZIP smoke on 2026-07-29: an isolated profile and disposable project confirmed PowerShell input/output, selected-project cwd, nested process-tree termination, and retained killed-session UI state.
- Terminal editing follow-up: manual source-app smoke confirmed Backspace, Delete, cursor movement, Home/End, and Ctrl+C. Targeted terminal tests 18/18, full unit suite 534/534, both TypeScript checks, UI 6/6, and package configuration smoke 8/8 passed.

## Recorded limitation

Node-pty's detached ConPTY helper printed `AttachConsole failed` after successful termination under Node 24, including packaged Electron/Node 24.13.1. No functional failure or process leak was observed; explicit Windows process-tree cleanup succeeded. This remains useful diagnostic context for future terminal/runtime investigations, not a prohibition on changing that implementation.
