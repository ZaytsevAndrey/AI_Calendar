import { readFileSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

export type TokenPair = {
  access_token: string;
  refresh_token: string;
};

export type PlaywrightAuthFile = {
  onboarded: TokenPair;
  needsSettings: TokenPair;
  needsPhases: TokenPair;
};

const authFilePath = path.resolve(__dirname, '..', '.tmp', 'auth.json');

export function readAuthFile(): PlaywrightAuthFile {
  return JSON.parse(readFileSync(authFilePath, 'utf8')) as PlaywrightAuthFile;
}

export function persistRootValue(tokens: TokenPair): string {
  return JSON.stringify({
    auth: JSON.stringify({
      isAuthenticated: true,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      loginStatus: 'success',
      error: null,
    }),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  });
}

/**
 * CI login for Playwright: seed JWTs from `e2e/.tmp/auth.json` (written when the
 * backend starts with `E2E_BOOTSTRAP=1`). Skips real Google OAuth; Google Calendar
 * API stays stubbed via `E2E_STUB_EXTERNAL=1`.
 */
export async function seedBrowserAuth(page: Page, tokens: TokenPair): Promise<void> {
  const persistRoot = persistRootValue(tokens);
  await page.addInitScript(
    ({ access, refresh, persist }) => {
      window.localStorage.setItem('access_token', access);
      window.localStorage.setItem('refresh_token', refresh);
      window.localStorage.setItem('persist:root', persist);
      // Tests read Now / Next from the Today panel; at 1280 px it starts closed without a stored choice.
      if (window.localStorage.getItem('luefy.todayPanel') === null) {
        window.localStorage.setItem('luefy.todayPanel', 'open');
      }
    },
    {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      persist: persistRoot,
    },
  );
}
