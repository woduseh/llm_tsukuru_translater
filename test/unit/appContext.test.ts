import { describe, it, expect, beforeEach } from 'vitest';

describe('appContext', () => {
  let appCtx: any;

  beforeEach(async () => {
    // Fresh import each time to reset module state
    const mod = await import('../../src/appContext');
    appCtx = mod.appCtx;
  });

  describe('initial state', () => {
    it('has null mainWindow', () => {
      expect(appCtx.mainWindow).toBeNull();
    });

    it('has null settingsWindow', () => {
      expect(appCtx.settingsWindow).toBeNull();
    });

    it('has empty gb object', () => {
      expect(appCtx.gb).toEqual({});
    });

    it('has useExternMsg as false', () => {
      expect(appCtx.useExternMsg).toBe(false);
    });

    it('has llmAbort as false', () => {
      expect(appCtx.llmAbort).toBe(false);
    });

    it('has empty oPath', () => {
      expect(appCtx.oPath).toBe('');
    });

    it('has empty sourceDir', () => {
      expect(appCtx.sourceDir).toBe('');
    });

    it('has WolfMetadata with ver -1', () => {
      expect(appCtx.WolfMetadata).toEqual({ ver: -1 });
    });

    it('has empty WolfExtData array', () => {
      expect(appCtx.WolfExtData).toEqual([]);
    });

    it('has empty WolfCache', () => {
      expect(appCtx.WolfCache).toEqual({});
    });
  });

  describe('direct property access', () => {
    it('setting appCtx property works', () => {
      appCtx.oPath = '/test/path';
      expect(appCtx.oPath).toBe('/test/path');
    });

    it('setting mainWindow works', () => {
      const fakeWindow = { id: 42 };
      appCtx.mainWindow = fakeWindow;
      expect(appCtx.mainWindow).toBe(fakeWindow);
    });

    it('setting boolean properties works', () => {
      appCtx.llmAbort = true;
      expect(appCtx.llmAbort).toBe(true);
      appCtx.llmAbort = false;
      expect(appCtx.llmAbort).toBe(false);
    });

    it('setting object properties works by reference', () => {
      const newSettings = { extractJs: true, theme: 'dark' };
      appCtx.settings = newSettings;
      expect(appCtx.settings).toBe(newSettings);
      expect(appCtx.settings.theme).toBe('dark');
    });

    it('setting WolfMetadata works', () => {
      appCtx.WolfMetadata = { ver: 2 };
      expect(appCtx.WolfMetadata).toEqual({ ver: 2 });
    });

    it('setting array properties works', () => {
      const data = [{ id: 1 }, { id: 2 }];
      appCtx.WolfExtData = data;
      expect(appCtx.WolfExtData).toBe(data);
      expect(appCtx.WolfExtData).toHaveLength(2);
    });
  });
});
