/**
 * Builds the CLI registration commands that point an external agent (Codex /
 * Claude) at the bundled project-protecting MCP server. Pure + dependency-free
 * so it can be unit-tested; the actual file copy lives in the IPC handler.
 */
export interface McpConnectionCommands {
  serverName: string;
  codex: string;
  claude: string;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildMcpConnectionCommands(
  serverPath: string,
  projectRoot: string,
  serverName = 'llm-tsukuru',
): McpConnectionCommands {
  const launch = `node ${quote(serverPath)} --project ${quote(projectRoot)}`;
  return {
    serverName,
    // codex mcp add <name> -- <command...>
    codex: `codex mcp add ${serverName} -- ${launch}`,
    // claude mcp add --transport stdio <name> -- <command...>  (options before name)
    claude: `claude mcp add --transport stdio ${serverName} -- ${launch}`,
  };
}
