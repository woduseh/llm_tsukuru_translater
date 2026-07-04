import { onMounted, onUnmounted, ref } from 'vue'
import type {
  TerminalCapability,
  TerminalEvent,
  TerminalOperationResult,
  TerminalSessionKind,
  TerminalSessionSummary,
} from '../../types/agentWorkspace'
import { applyTerminalEvent, mergeTerminalSession } from '../agentWorkspaceModel'
import { api } from './useIpc'

const sessions = ref<TerminalSessionSummary[]>([])
const capability = ref<TerminalCapability | null>(null)
let consumerCount = 0
let unsubscribeSessions: (() => void) | null = null
let unsubscribeEvents: (() => void) | null = null

function applyResult(result: TerminalOperationResult): TerminalOperationResult {
  if (result.capability) capability.value = result.capability
  if (result.sessions) sessions.value = [...result.sessions]
  if (result.session) sessions.value = mergeTerminalSession(sessions.value, result.session)
  if (result.snapshot?.session) sessions.value = mergeTerminalSession(sessions.value, result.snapshot.session)
  return result
}

function applyEvent(event: TerminalEvent): void {
  sessions.value = sessions.value.map((session) => (
    session.sessionId === event.sessionId ? applyTerminalEvent(session, event) : session
  ))
}

async function refresh(): Promise<TerminalOperationResult> {
  return applyResult(await api.terminal.list())
}

async function launch(kind: TerminalSessionKind): Promise<TerminalOperationResult> {
  return applyResult(await api.terminal.create({
    schemaVersion: 1,
    requestId: `renderer-${Date.now()}`,
    kind,
  }))
}

async function kill(sessionId: string): Promise<TerminalOperationResult> {
  return applyResult(await api.terminal.kill({ schemaVersion: 1, sessionId }))
}

function connect(): void {
  consumerCount += 1
  if (consumerCount > 1) return
  unsubscribeSessions = api.terminal.onSessions(applyResult)
  unsubscribeEvents = api.terminal.onEvent(applyEvent)
  void refresh()
}

function disconnect(): void {
  consumerCount = Math.max(0, consumerCount - 1)
  if (consumerCount > 0) return
  unsubscribeSessions?.()
  unsubscribeEvents?.()
  unsubscribeSessions = null
  unsubscribeEvents = null
}

export function useTerminalSessions() {
  onMounted(connect)
  onUnmounted(disconnect)
  return {
    sessions,
    capability,
    refresh,
    launch,
    kill,
    applyResult,
  }
}
