import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.js', 'src/html/**', 'src/types/**'],
    },
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json'],
  },
});
