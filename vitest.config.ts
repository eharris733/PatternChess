import { defineConfig } from 'vitest/config';

// Unit tests only — Playwright owns tests/e2e/*.spec.ts, so vitest is scoped
// to co-located src/**/*.test.ts files.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
