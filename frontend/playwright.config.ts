import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5174', // Use a different port to not conflict with regular dev server
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_MOCK_EYE: '1',
      VITE_MOCK_EMOTION: '1',
      VITE_STT_PROVIDER: 'mock',
      VITE_MOCK_CONVERSATION: '1',
      VITE_TTS_PROVIDER: 'silent'
    }
  },
});
