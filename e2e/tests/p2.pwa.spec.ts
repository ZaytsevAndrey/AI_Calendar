import { test, expect, openAs } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

async function fireInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    Object.assign(event, {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });
}

/** Strict Mode remounts drop a prompt that landed on the first mount; retry until the banner sticks. */
async function showInstallBanner(page: Page) {
  const copy = page.getByText('Install AI Calendar on this device for quicker voice capture.');
  await expect(async () => {
    await fireInstallPrompt(page);
    await expect(copy).toBeVisible({ timeout: 500 });
  }).toPass();
}

test.describe('P2 PWA banner', () => {
  test('U-PWA-001 beforeinstallprompt shows the install banner', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    await showInstallBanner(page);
    await expect(page.getByRole('button', { name: 'Install' })).toBeVisible();
  });

  test('U-PWA-002 dismiss stays hidden on reload', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    await showInstallBanner(page);
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByText('Install AI Calendar on this device for quicker voice capture.')).toHaveCount(0);
    const dismissed = await page.evaluate(() => window.localStorage.getItem('pwa-install-dismissed'));
    expect(dismissed).toBe('1');

    await page.reload();
    await fireInstallPrompt(page);
    await expect(page.getByText('Install AI Calendar on this device for quicker voice capture.')).toHaveCount(0);
  });

  test.describe('U-PWA-003 iOS hint', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    test('shows the Share hint without beforeinstallprompt', async ({ page, auth }) => {
      await openAs(page, auth.onboarded);
      await expect(page.getByText('On iPhone: Share → Add to Home Screen to install the app.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0);
    });
  });
});
