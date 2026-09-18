import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: {
    baseURL: process.env.UI_HARNESS_BASE_URL || 'http://127.0.0.1:4173',
    // Use the full browser's headless compositor for WebGL and native RAF tests.
    channel: process.env.UI_HARNESS_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    headless: true,
    // SwiftShader on CI has no physical display vsync; preserve native RAF and
    // its frame-rate limit while avoiding GPU swap synchronization stalls.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync'] },
    viewport: { width: 1600, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.UI_HARNESS_EXTERNAL_SERVER === '1' ? undefined : {
    command: process.env.UI_HARNESS_PREVIEW === '1' ? 'npm run preview' : 'npm run dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
