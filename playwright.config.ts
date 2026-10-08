import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 2, timeout: 30_000, fullyParallel: true,
  use: { baseURL: process.env.PUBLIC_TEST_URL ?? 'http://127.0.0.1:8124', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  webServer: [
    { command: 'npm run dev -- --port 8127', port: 8127, reuseExistingServer: false },
    ...(process.env.PUBLIC_TEST_URL ? [] : [{ command: 'npm run preview -- --host 127.0.0.1 --port 8124 --strictPort', port: 8124, reuseExistingServer: false }]),
  ],
});
