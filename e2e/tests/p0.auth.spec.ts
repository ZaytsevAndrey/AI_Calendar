import { test, expect, openAs } from '../helpers/fixtures';

test.describe('P0 auth UI', () => {
  test('U-AUTH-002 Continue with Google navigates to the auth URL', async ({ page }) => {
    const stubUrl = 'https://example.com/e2e-google-oauth';
    await page.route('**/auth/google', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: stubUrl }),
      });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.waitForURL(/example\.com\/e2e-google-oauth/, {
      waitUntil: 'commit',
      timeout: 15_000,
    });
  });

  test('U-AUTH-004 callback ticket stores tokens and leaves login', async ({ page, auth }) => {
    await page.route('**/auth/google/session', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(auth.onboarded),
      });
    });

    await page.goto('/auth/google/callback?ticket=pw-ui-ticket');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    const access = await page.evaluate(() => window.localStorage.getItem('access_token'));
    expect(access).toBe(auth.onboarded.access_token);
  });

  test('U-AUTH-005 authenticated login route goes to calendar', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/login');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('U-AUTH-010 legacy auth paths redirect to login or home', async ({ page, auth }) => {
    for (const path of ['/register', '/forgot-password', '/reset-password']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }

    await openAs(page, auth.onboarded, '/register');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  });

  test('U-AUTH-011 alias routes canonicalize', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/events');
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();

    await page.goto('/schedule');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();

    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  });
});
