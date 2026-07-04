// Bundles the project-protecting MCP stdio server into a single dependency-free
// .cjs so
// external CLIs (Codex/Claude) can launch it with system `node` from a stable
// path, independent of the app's (portable, temp) install location.
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'src/mcp/mcpStdioServer.ts')],
  outfile: path.join(root, 'res/mcp-agent-server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

console.log('Bundled -> res/mcp-agent-server.cjs');
