import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonFile } from '../ts/libs/atomicFile';
import { AgentSafeFileSystem } from './agentSafeFileSystem';
import { SandboxPathError } from './agentFileErrors';

export const AGENT_WORKSPACE_DIRECTORY = '.llm-tsukuru-agent';

/** Project-owned analysis storage. Recheck existing links on every access. */
export class AgentWorkspaceStorage {
  readonly projectRoot: string;
  readonly workspaceRoot: string;
  private readonly files: AgentSafeFileSystem;

  constructor(projectRoot: string, workspaceRoot = path.join(projectRoot, AGENT_WORKSPACE_DIRECTORY)) {
    this.files = new AgentSafeFileSystem({ projectRoot });
    this.projectRoot = this.files.projectRoot;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.files.resolveAllowed(this.workspaceRoot);
  }

  resolve(candidate: string): string {
    const root = this.files.resolveAllowed(this.workspaceRoot);
    const target = this.files.resolveAllowed(path.resolve(this.workspaceRoot, candidate));
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new SandboxPathError('Path escapes the agent workspace.');
    }
    return target;
  }

  ensureDirectory(relativePath: string): string {
    fs.mkdirSync(this.resolve(relativePath), { recursive: true });
    return this.resolve(relativePath);
  }

  writeJson(relativePath: string, value: unknown): void {
    this.ensureDirectory(path.dirname(relativePath));
    atomicWriteJsonFile(this.resolve(relativePath), value, 2);
  }

  appendText(relativePath: string, content: string): void {
    this.ensureDirectory(path.dirname(relativePath));
    fs.appendFileSync(this.resolve(relativePath), content, 'utf-8');
  }
}
