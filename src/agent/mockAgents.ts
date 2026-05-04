import type { AgentResultEnvelope, GoldenWorkflowTranscript, JsonObject } from '../types/agentWorkspace';
import { MockMcpClient, MockMcpServer } from './mockMcp';

export type MockAgentScenario = 'well-behaved' | 'malicious-path' | 'approval-replay';

export interface MockAgentAction {
  toolName: string;
  input: JsonObject;
}

export function createMockAgentScript(scenario: MockAgentScenario): MockAgentAction[] {
  if (scenario === 'malicious-path') {
    return [{ toolName: 'project.context_snapshot', input: { projectId: '..\\..\\outside' } }];
  }
  if (scenario === 'approval-replay') {
    return [
      { toolName: 'project.context_snapshot', input: { projectId: 'approval-replay' } },
      { toolName: 'project.context_snapshot', input: { projectId: 'approval-replay', replayApprovalId: 'old-approval' } },
    ];
  }
  return [
    { toolName: 'project.context_snapshot', input: { projectId: 'well-behaved' } },
    { toolName: 'project.translation_inventory', input: {} },
    { toolName: 'quality.review_batch', input: { batchId: 'well-behaved-review' } },
  ];
}

export function runMockAgentScript(client: MockMcpClient, script: MockAgentAction[]): AgentResultEnvelope[] {
  const results: AgentResultEnvelope[] = [];
  for (const action of script) {
    results.push(client.callTool(action.toolName, action.input, results));
  }
  return results;
}

export function runGoldenWorkflow(client = new MockMcpClient(new MockMcpServer())): { transcript: GoldenWorkflowTranscript; results: AgentResultEnvelope[] } {
  const results = runMockAgentScript(client, createMockAgentScript('well-behaved'));
  return {
    results,
    transcript: {
      schemaVersion: 1,
      workflowId: 'golden-project-context-inventory-review',
      createdAt: new Date().toISOString(),
      steps: results.map((result) => ({
        toolName: result.toolName,
        requestId: result.requestId,
        status: result.status,
        permissionTier: result.permissionTier,
      })),
      finalStatus: results.every((result) => result.status === 'ok') ? 'ok' : 'failed',
      artifacts: ['mock://project.context_snapshot', 'mock://project.translation_inventory', 'mock://quality.review_batch'],
    },
  };
}
