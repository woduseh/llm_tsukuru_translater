import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['test/**/*.test.ts'],
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
  },
});
