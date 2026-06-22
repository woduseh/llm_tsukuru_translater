import { describe, expect, it } from 'vitest';
import { buildAgentWorkspaceStatus } from '../../src/agent/agentWorkspaceStatus';
import { deriveAgentTimeline, derivePresetMcpStatus } from '../../src/renderer/agentWorkspaceModel';

describe('buildAgentWorkspaceStatus', () => {
  it('reports no project when no roots are registered', () => {
    const status = buildAgentWorkspaceStatus({
      projectRoots: [],
      providerReadyError: 'no provider',
    });
    expect(status.project.selected).toBe(false);
    expect(status.project.label).toBe('프로젝트 미선택');
  });

  it('uses the basename of the active project root', () => {
    const status = buildAgentWorkspaceStatus({
      projectRoots: ['C:\\games\\projectA', 'C:\\games\\projectB'],
      currentProjectRoot: 'C:\\games\\projectB\\',
      providerReadyError: null,
    });
    expect(status.project.selected).toBe(true);
    expect(status.project.label).toBe('projectB');
  });

  it('falls back to the last root when no active root is set', () => {
    const status = buildAgentWorkspaceStatus({
      projectRoots: ['/home/me/alpha', '/home/me/beta'],
      providerReadyError: null,
    });
    expect(status.project.label).toBe('beta');
  });

  it('maps provider readiness from the readiness error', () => {
    expect(buildAgentWorkspaceStatus({ projectRoots: [], providerReadyError: null }).provider.ready).toBe(true);
    const notReady = buildAgentWorkspaceStatus({ projectRoots: [], providerReadyError: 'API 키가 없습니다.' });
    expect(notReady.provider.ready).toBe(false);
    expect(notReady.provider.message).toBe('API 키가 없습니다.');
  });

  it('marks the terminal available only when capability is enabled', () => {
    expect(buildAgentWorkspaceStatus({ projectRoots: [], providerReadyError: null, terminalCapabilityStatus: 'enabled' }).terminal.available).toBe(true);
    const degraded = buildAgentWorkspaceStatus({
      projectRoots: [],
      providerReadyError: null,
      terminalCapabilityStatus: 'degraded',
      terminalReason: '프로젝트 폴더를 선택하세요.',
    });
    expect(degraded.terminal.available).toBe(false);
    expect(degraded.terminal.message).toBe('프로젝트 폴더를 선택하세요.');
  });

  it('always exposes the read-only MCP server as available', () => {
    const status = buildAgentWorkspaceStatus({ projectRoots: [], providerReadyError: null });
    expect(status.mcp.readonlyServerAvailable).toBe(true);
    expect(status.schemaVersion).toBe(1);
  });
});

describe('deriveAgentTimeline', () => {
  const byId = (steps: ReturnType<typeof deriveAgentTimeline>) =>
    Object.fromEntries(steps.map((step) => [step.id, step.status]));

  it('keeps every step waiting when nothing is ready', () => {
    const steps = byId(deriveAgentTimeline({ projectSelected: false, providerReady: false }));
    expect(Object.values(steps).every((status) => status === 'waiting')).toBe(true);
  });

  it('unlocks project and extract steps once a project is selected', () => {
    const steps = byId(deriveAgentTimeline({ projectSelected: true, providerReady: false }));
    expect(steps['project-selected']).toBe('ready');
    expect(steps['extract-preview']).toBe('ready');
    expect(steps['quality-review']).toBe('waiting');
    expect(steps['safe-apply']).toBe('waiting');
  });

  it('unlocks all steps when project and provider are ready', () => {
    const steps = byId(deriveAgentTimeline({ projectSelected: true, providerReady: true }));
    expect(Object.values(steps).every((status) => status === 'ready')).toBe(true);
  });
});

describe('derivePresetMcpStatus', () => {
  it('keeps the generic shell disconnected regardless of signals', () => {
    expect(derivePresetMcpStatus('generic', {
      readonlyServerAvailable: true, executableAvailable: true, projectSelected: true,
    })).toBe('disconnected');
  });

  it('is disconnected when the read-only MCP server is unavailable', () => {
    expect(derivePresetMcpStatus('codex', {
      readonlyServerAvailable: false, executableAvailable: true, projectSelected: true,
    })).toBe('disconnected');
  });

  it('is enabled when the executable is present and a project is selected', () => {
    expect(derivePresetMcpStatus('codex', {
      readonlyServerAvailable: true, executableAvailable: true, projectSelected: true,
    })).toBe('enabled');
  });

  it('is degraded when only some prerequisites are met', () => {
    expect(derivePresetMcpStatus('claude', {
      readonlyServerAvailable: true, executableAvailable: true, projectSelected: false,
    })).toBe('degraded');
    expect(derivePresetMcpStatus('claude', {
      readonlyServerAvailable: true, executableAvailable: false, projectSelected: true,
    })).toBe('degraded');
  });
});
