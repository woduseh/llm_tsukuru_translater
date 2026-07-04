import type { TerminalEvent, TerminalEventKind } from '../../src/types/agentWorkspace';

export function createMockTerminalEvent(
  sessionId: string,
  sequence: number,
  kind: TerminalEventKind,
  data?: string,
): TerminalEvent {
  const event: TerminalEvent = {
    schemaVersion: 1,
    sessionId,
    sequence,
    kind,
    timestamp: new Date().toISOString(),
    data,
    redacted: true,
  };
  if (kind === 'exit') event.exitCode = 0;
  return event;
}
