import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { API_BASE, API_PORT, JWT_SECRET, UI_BASE, UI_PORT } from './constants';

const repoRoot = path.resolve(__dirname, '..');
const sqlitePath = path.join(repoRoot, 'e2e', '.tmp', 'playwright.sqlite');
const authFile = path.join(repoRoot, 'e2e', '.tmp', 'auth.json');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: UI_BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start --workspace=backend',
      url: `${API_BASE}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        JWT_SECRET,
        JWT_EXPIRES_IN: '1h',
        DATABASE_URL: '',
        SQLITE_PATH: sqlitePath,
        TYPEORM_SYNC: 'true',
        FRONTEND_URL: UI_BASE,
        E2E_BOOTSTRAP: '1',
        E2E_STUB_EXTERNAL: '1',
        E2E_AUTH_FILE: authFile,
      },
    },
    {
      command: 'npm run start --workspace=frontend',
      url: UI_BASE,
      timeout: 180_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      env: {
        ...process.env,
        PLAYWRIGHT: '1',
        WEBPACK_DEV_PORT: String(UI_PORT),
        REACT_APP_API_BASE_URL: API_BASE,
      },
    },
  ],
});
