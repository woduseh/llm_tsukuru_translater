import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Track global property names installed by syncToGlobal so we can clean up
const syncedGlobalNames = [
  'mwindow', 'settingsWindow', 'settings', 'gb', 'externMsg',
  'useExternMsg', 'externMsgKeys', 'llmAbort', 'oPath', 'sourceDir',
  'iconPath', 'keyvalue', 'loadEn', 'WolfExtData', 'WolfEncoding',
  'WolfCache', 'WolfMetadata',
];

describe('appContext', () => {
  let appCtx: any;
  let initAppContext: any;

  beforeEach(async () => {
    // Clean any stale global properties before each test
    const g = globalThis as any;
    for (const name of syncedGlobalNames) {
      delete g[name];
    }

    // Fresh import each time to reset module state
    const mod = await import('../../src/appContext');
    appCtx = mod.appCtx;
    initAppContext = mod.initAppContext;
  });

  afterEach(() => {
    const g = globalThis as any;
    for (const name of syncedGlobalNames) {
      delete g[name];
    }
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

    it('has WolfEncoding as utf8', () => {
      expect(appCtx.WolfEncoding).toBe('utf8');
    });

    it('has WolfMetadata with ver -1', () => {
      expect(appCtx.WolfMetadata).toEqual({ ver: -1 });
    });

    it('has undefined keyvalue', () => {
      expect(appCtx.keyvalue).toBeUndefined();
    });

    it('has empty WolfExtData array', () => {
      expect(appCtx.WolfExtData).toEqual([]);
    });

    it('has empty WolfCache', () => {
      expect(appCtx.WolfCache).toEqual({});
    });
  });

  describe('syncToGlobal (via initAppContext)', () => {
    it('setting appCtx property is reflected on globalThis', () => {
      initAppContext();
      const g = globalThis as any;

      appCtx.oPath = '/test/path';
      expect(g.oPath).toBe('/test/path');
    });

    it('setting globalThis property is reflected on appCtx', () => {
      initAppContext();
      const g = globalThis as any;

      g.oPath = '/another/path';
      expect(appCtx.oPath).toBe('/another/path');
    });

    it('maps mwindow global to mainWindow on appCtx', () => {
      initAppContext();
      const g = globalThis as any;

      const fakeWindow = { id: 42 };
      appCtx.mainWindow = fakeWindow;
      expect(g.mwindow).toBe(fakeWindow);
    });

    it('maps mwindow global setter to mainWindow on appCtx', () => {
      initAppContext();
      const g = globalThis as any;

      const fakeWindow = { id: 99 };
      g.mwindow = fakeWindow;
      expect(appCtx.mainWindow).toBe(fakeWindow);
    });

    it('syncs boolean properties bidirectionally', () => {
      initAppContext();
      const g = globalThis as any;

      appCtx.llmAbort = true;
      expect(g.llmAbort).toBe(true);

      g.llmAbort = false;
      expect(appCtx.llmAbort).toBe(false);
    });

    it('syncs object properties by reference', () => {
      initAppContext();
      const g = globalThis as any;

      const newSettings = { extractJs: true, theme: 'dark' };
      appCtx.settings = newSettings;
      expect(g.settings).toBe(newSettings);
      expect(g.settings.theme).toBe('dark');
    });

    it('syncs WolfMetadata bidirectionally', () => {
      initAppContext();
      const g = globalThis as any;

      g.WolfMetadata = { ver: 2 };
      expect(appCtx.WolfMetadata).toEqual({ ver: 2 });

      appCtx.WolfMetadata = { ver: 3 };
      expect(g.WolfMetadata).toEqual({ ver: 3 });
    });

    it('syncs array properties', () => {
      initAppContext();
      const g = globalThis as any;

      const data = [{ id: 1 }, { id: 2 }];
      appCtx.WolfExtData = data;
      expect(g.WolfExtData).toBe(data);
      expect(g.WolfExtData).toHaveLength(2);
    });

    it('multiple syncs do not conflict', () => {
      initAppContext();
      initAppContext(); // call twice
      const g = globalThis as any;

      appCtx.sourceDir = '/dir1';
      expect(g.sourceDir).toBe('/dir1');

      g.sourceDir = '/dir2';
      expect(appCtx.sourceDir).toBe('/dir2');
    });
  });
});
