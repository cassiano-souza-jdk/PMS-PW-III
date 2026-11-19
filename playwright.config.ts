import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const previewCommand =
  process.platform === 'win32'
    ? 'pnpm.cmd preview --host 127.0.0.1 --port 4173 --strictPort'
    : 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: previewCommand,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
