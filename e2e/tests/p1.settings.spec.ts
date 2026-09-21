import { test, expect, openAs, apiJson, expectOk } from '../helpers/fixtures';

test.describe('P1 settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/google-calendar/check-connection', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: true }),
      });
    });
  });

  test.afterEach(async ({ auth, request }) => {
    await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
      googleCalendarLinked: true,
      wakeTime: '08:00',
      sleepTime: '23:00',
      timeZone: 'Europe/Kyiv',
    });
  });
  test('U-SET-001 changing horizon auto-saves after debounce', async ({ page, auth, request }) => {
    await openAs(page, auth.onboarded, '/settings');
    const horizon = page.getByLabel('Recurring schedule horizon (days)');
    await expect(horizon).toBeVisible();
    const current = Number((await horizon.inputValue()) || '14');
    const next = current === 21 ? 22 : 21;
    await horizon.fill(String(next));
    await expect(page.getByText('Settings saved')).toBeVisible({ timeout: 5_000 });
    const saved = await apiJson(request, auth.onboarded.access_token, 'get', '/user-settings');
    expectOk(saved);
    expect(saved.body.recurringScheduleHorizonDays).toBe(next);
  });

  test.describe('U-SET-002 empty TZ', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('client PATCHes browser IANA once', async ({ page, auth, request }) => {
      const current = await apiJson(request, auth.needsSettings.access_token, 'get', '/user-settings');
      expectOk(current);
      const patches: Array<Record<string, unknown>> = [];

      await page.route('**/user-settings**', async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        if (url.pathname.endsWith('/user-settings/required')) {
          await route.continue();
          return;
        }
        if (method === 'GET' && url.pathname.endsWith('/user-settings')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...current.body, timeZone: '' }),
          });
          return;
        }
        if (method === 'PATCH' && url.pathname.endsWith('/user-settings')) {
          const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
          patches.push(body);
        }
        await route.continue();
      });

      await openAs(page, auth.needsSettings, '/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect.poll(() => patches.some((body) => body.timeZone === 'America/New_York')).toBe(true);
    });
  });

  test.describe('U-SET-003 TZ already set', () => {
    test.use({ timezoneId: 'America/Denver' });

    test('reload does not overwrite a saved zone', async ({ page, auth }) => {
      const patches: string[] = [];
      await page.route('**/user-settings**', async (route) => {
        const method = route.request().method();
        const pathname = new URL(route.request().url()).pathname;
        if (method === 'PATCH' && pathname.endsWith('/user-settings')) {
          const body = (route.request().postDataJSON() || {}) as { timeZone?: string };
          if (body.timeZone) patches.push(body.timeZone);
        }
        await route.continue();
      });

      await openAs(page, auth.onboarded, '/settings');
      await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Kyiv');
      await page.reload();
      await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Kyiv');
      expect(patches.filter((zone) => zone === 'America/Denver')).toEqual([]);
    });
  });

  test('U-SET-004 Google status follows check-connection and has no disconnect', async ({
    page,
    auth,
  }) => {
    await openAs(page, auth.onboarded, '/settings');
    await expect(page.getByText('Linked with your Google account')).toBeVisible();
    await expect(page.getByRole('button', { name: /disconnect|unlink/i })).toHaveCount(0);
  });
});
