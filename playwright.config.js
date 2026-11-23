var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig, devices } from '@playwright/test';
// PW_PORT runs the suite against its own dev server (default 5173), so several
// checkouts can run e2e at once; the started `npm run dev` gets it as PORT.
var port = Number(process.env.PW_PORT) || 5173;
var baseURL = "http://localhost:".concat(port);
export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    expect: { timeout: 10000 },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? 'list' : [['list']],
    use: {
        baseURL: baseURL,
        trace: 'retain-on-failure',
        headless: true,
    },
    projects: [
        {
            name: 'chromium',
            use: __assign({}, devices['Desktop Chrome']),
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: baseURL,
        env: { PORT: String(port) },
        reuseExistingServer: true,
        timeout: 60000,
    },
});
