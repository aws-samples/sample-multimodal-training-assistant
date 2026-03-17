import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    storageState: './e2e/.auth/session.json',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'auth-setup', testMatch: /auth\.setup\.ts/, use: { storageState: undefined } },
    { name: 'tests', dependencies: ['auth-setup'] },
  ],
});
