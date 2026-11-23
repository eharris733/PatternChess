import { defineConfig } from 'vitest/config';

// Unit tests only — Playwright owns tests/e2e/*.spec.ts, so vitest is scoped
// to co-located src/, workers/, functions/ and scripts/ **/*.test.ts files.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'workers/**/*.test.ts', 'functions/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
