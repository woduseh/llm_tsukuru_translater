import type { ApprovalRequest, JsonObject, TerminalEvent } from '../types/agentWorkspace';

export type AgentEventKind = 'job' | 'approval' | 'terminal' | 'mcp' | 'artifact';

export interface AgentEventBase {
  schemaVersion: 1;
  eventId: string;
  kind: AgentEventKind;
  timestamp: string;
  workspaceRoot: string;
}

export interface AgentJobEvent extends AgentEventBase {
  kind: 'job';
  jobId: string;
  status: string;
  message?: string;
  progress?: JsonObject;
}

export interface AgentApprovalEvent extends AgentEventBase {
  kind: 'approval';
  approval: ApprovalRequest;
}

export interface AgentTerminalActivityEvent extends AgentEventBase {
  kind: 'terminal';
  terminal: TerminalEvent;
}

export interface AgentMcpEvent extends AgentEventBase {
  kind: 'mcp';
  toolName: string;
  requestId?: string;
  status: string;
  metadata?: JsonObject;
}

export interface AgentArtifactEvent extends AgentEventBase {
  kind: 'artifact';
  artifactPath: string;
  artifactKind: string;
  jobId?: string;
}

export type AgentEvent = AgentJobEvent | AgentApprovalEvent | AgentTerminalActivityEvent | AgentMcpEvent | AgentArtifactEvent;
export type AgentEventListener = (event: AgentEvent) => void;
type NewAgentEvent<T extends AgentEvent = AgentEvent> = T extends AgentEvent
  ? Omit<T, 'schemaVersion' | 'eventId' | 'timestamp' | 'workspaceRoot'> & Partial<Pick<AgentEventBase, 'timestamp'>>
  : never;

export interface EventBusOptions {
  workspaceRoot: string;
  maxHistory?: number;
  idFactory?: () => string;
}

export class AgentEventBus {
  private readonly listeners = new Set<AgentEventListener>();
  private readonly history: AgentEvent[] = [];
  private readonly maxHistory: number;
  private readonly idFactory: () => string;
  readonly workspaceRoot: string;

  constructor(options: EventBusOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.maxHistory = Math.max(1, options.maxHistory ?? 200);
    this.idFactory = options.idFactory ?? (() => `event-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: NewAgentEvent): AgentEvent {
    const fullEvent = {
      ...event,
      schemaVersion: 1,
      eventId: this.idFactory(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      workspaceRoot: this.workspaceRoot,
    } as AgentEvent;
    this.history.push(fullEvent);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    for (const listener of Array.from(this.listeners)) {
      listener(fullEvent);
    }
    return fullEvent;
  }

  getHistory(): AgentEvent[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history.splice(0);
  }
}
