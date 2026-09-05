import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const app = vi.hoisted(() => ({ setPath: vi.fn(), setAppLogsPath: vi.fn(), once: vi.fn(), quit: vi.fn(), isPackaged: false }));
const ipcMain = vi.hoisted(() => ({ once: vi.fn() }));
vi.mock('electron', () => ({ app, ipcMain }));

describe('UI harness profile isolation', () => {
  let workspace: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-profile-test-'));
    vi.stubEnv('LLM_TSUKURU_UI_HARNESS_SCENARIO', '');
    vi.stubEnv('LLM_TSUKURU_UI_HARNESS_USER_DATA', '');
    vi.stubEnv('LLM_TSUKURU_DEV_USER_DATA', '');
    vi.stubEnv('LLM_TSUKURU_DEV_SMOKE', '');
  });

  afterEach(() => {
    for (const [event, callback] of app.once.mock.calls) if (event === 'will-quit') callback();
    vi.unstubAllEnvs();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('does not change the profile of a normal app launch', async () => {
    await import('../src/harness/uiHarnessEnvironment');
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setAppLogsPath).not.toHaveBeenCalled();
  });

  it.each(['', 'relative-profile'])('rejects an unsafe harness profile %j before app startup', async (profile) => {
    vi.stubEnv('LLM_TSUKURU_UI_HARNESS_SCENARIO', 'scenario.json');
    vi.stubEnv('LLM_TSUKURU_UI_HARNESS_USER_DATA', profile);
    await expect(import('../src/harness/uiHarnessEnvironment')).rejects.toThrow('absolute isolated');
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('creates and assigns separate persistent, session, and logging paths', async () => {
    const profile = path.join(workspace, 'profile');
    vi.stubEnv('LLM_TSUKURU_UI_HARNESS_SCENARIO', 'scenario.json');
    vi.stubEnv('LLM_TSUKURU_UI_HARNESS_USER_DATA', profile);
    await import('../src/harness/uiHarnessEnvironment');
    expect(app.setPath).toHaveBeenCalledWith('userData', profile);
    expect(app.setPath).toHaveBeenCalledWith('sessionData', path.join(profile, 'session'));
    expect(app.setAppLogsPath).toHaveBeenCalledWith(path.join(profile, 'logs'));
    expect(fs.statSync(path.join(profile, 'session')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(profile, 'logs')).isDirectory()).toBe(true);
  });
});
