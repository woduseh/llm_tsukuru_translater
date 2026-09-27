import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const isolatedTests = [
  // Module mocks and Electron/logger singletons intentionally need a fresh module graph.
  'test/unit/agentWorkspacePage.test.ts',
  'test/unit/comparePage.test.ts',
  'test/unit/jsonReviewWorkspace.test.ts',
  'test/unit/projectSnapshot.test.ts',
  'test/unit/settingsPageDraft.test.ts',
  'test/unit/ipcHandlers.test.ts',
  'test/unit/jsonRepairBoundary.test.ts',
  'test/unit/llmSettingsPage.test.ts',
  'test/unit/mvApplyTransaction.test.ts',
  'test/unit/rendererIpcLifecycle.test.ts',
  'test/unit/reviewTextWrite.test.ts',
  'test/unit/uiCapture.test.ts',
  'test/unit/workspaceIpc.test.ts',
  'test/unit/workspaceNavigation.test.ts',
];

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    // Worker threads keep file parallelism while avoiding fork startup/module-load overhead.
    pool: 'threads',
    // Opt-in concurrent cases share a worker; cap their own async fan-out independently.
    maxConcurrency: 2,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'artifacts/unit/coverage',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
    },
    // Most unit files clean up their state and can share a worker/module graph.
    // Keep the small set with deliberate module/global mocking isolated.
    projects: [
      {
        test: {
          name: 'shared-unit',
          include: ['test/**/*.test.ts'],
          exclude: isolatedTests,
          isolate: false,
        },
      },
      {
        test: {
          name: 'isolated-unit',
          include: isolatedTests,
          isolate: true,
        },
      },
    ],
  },
});
