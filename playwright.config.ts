import { defineConfig, devices } from '@playwright/test';

// PW_PORT runs the suite against its own dev server (default 5173), so several
// checkouts can run e2e at once; the started `npm run dev` gets it as PORT.
const port = Number(process.env.PW_PORT) || 5173;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    headless: true,
    // English unless a spec opts in: the app follows navigator.language.
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    env: { PORT: String(port) },
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
