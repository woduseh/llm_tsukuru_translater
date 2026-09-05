import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
    },
  },
});
