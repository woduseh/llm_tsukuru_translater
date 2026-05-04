import * as readline from 'readline';
import { AgentService } from '../agent/agentService';
import { createMcpReadonlyToolRegistry } from './readonlyTools';
import { ProtocolLightMcpServer, type JsonRpcRequest } from './protocolLight';

export function createOfflineReadonlyMcpServer(projectRoot = process.cwd()): ProtocolLightMcpServer {
  const service = new AgentService({ projectRoot });
  return new ProtocolLightMcpServer(createMcpReadonlyToolRegistry(service));
}

export function runProtocolLightStdioServer(projectRoot = process.cwd()): void {
  const server = createOfflineReadonlyMcpServer(projectRoot);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const response = server.handle(JSON.parse(line) as JsonRpcRequest);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
      }) + '\n');
    }
  });
}

if (require.main === module) {
  const projectFlagIndex = process.argv.indexOf('--project');
  runProtocolLightStdioServer(projectFlagIndex >= 0 && process.argv[projectFlagIndex + 1] ? process.argv[projectFlagIndex + 1] : process.cwd());
}
