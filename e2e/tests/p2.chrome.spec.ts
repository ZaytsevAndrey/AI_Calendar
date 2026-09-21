import { test, expect, openAs, apiJson, expectOk, uniqueName, deleteUnusedTimePhases } from '../helpers/fixtures';
import { API_BASE } from '../constants';

test.describe('P2 chrome and empty states', () => {
  test('U-SET-005 settings loading then retry on API error', async ({ page, auth }) => {
    await page.route('**/user-settings**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/user-settings/required') || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      if (!url.pathname.endsWith('/user-settings')) {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'settings down' }),
      });
    });

    await openAs(page, auth.onboarded, '/settings');
    await expect(
      page.getByRole('heading', { name: 'Loading settings…' }).or(
        page.getByRole('heading', { name: 'Could not load settings' }),
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Could not load settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('U-TSK-019 empty task lists are not a stuck spinner', async ({ page, auth }) => {
    await page.route(`${API_BASE}/tasks`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await openAs(page, auth.onboarded, '/tasks');
    await expect(page.getByText('Loading tasks…')).toHaveCount(0);
    await expect(page.getByText('No unscheduled tasks.')).toBeVisible();
    await expect(page.getByText('No scheduled tasks in this filter.')).toBeVisible();
  });

  test('U-HAB-005 empty habits state', async ({ page, auth }) => {
    await page.route(`${API_BASE}/habits`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          today: '2026-09-21',
          yesterday: '2026-09-20',
          timeZone: 'Europe/Kyiv',
          habits: [],
        }),
      });
    });

    await openAs(page, auth.onboarded, '/habits');
    await expect(page.getByText('No habits yet. Add one — for example Exercise or No smoking.')).toBeVisible();
    await expect(page.getByText(/Today \d+\//)).toHaveCount(0);
  });

  test('U-CAL-018 clear with nothing to delete shows the info toast', async ({ page, auth }) => {
    await page.route('**/schedule', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: 0 }),
      });
    });

    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Clear schedule' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Clear schedule' });
    await confirm.getByRole('button', { name: 'Clear schedule' }).click();
    await expect(page.getByText('Nothing to clear')).toBeVisible();
  });

  test('U-PH-006 overnight phase appears on the day grid', async ({ page, auth, request }) => {
    await deleteUnusedTimePhases(request, auth.onboarded.access_token);
    const name = uniqueName('P2 overnight');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/phases', {
      name,
      color: '#8844aa',
      startTime: '22:00',
      endTime: '02:00',
      weekDays: [0, 1, 2, 3, 4, 5, 6],
      type: 'time_phase',
    });
    expectOk(created);

    try {
      await openAs(page, auth.onboarded);
      await page.getByRole('button', { name: 'Day', exact: true }).click();
      await expect(page.getByText(`${name} (22:00-02:00)`)).toBeVisible();
      const slot = page.locator('div').filter({ has: page.getByText('22:00', { exact: true }) }).filter({
        hasText: name,
      });
      await expect(slot.first()).toBeVisible();
    } finally {
      await apiJson(request, auth.onboarded.access_token, 'delete', `/phases/${created.body.id}`);
    }
  });
});
