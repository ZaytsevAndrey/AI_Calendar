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
    await expect(page.getByText('No scheduled tasks in this filter.')).toBeVisible();
    await page.getByRole('tab', { name: 'Later' }).click();
    await expect(page.getByText('No tasks for later.')).toBeVisible();
  });

  test.skip('U-HAB-005 empty habits state (habits disabled for MVP)', async () => {});

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
      // The legend lists phases with their hours in a popover.
      await page.getByRole('button', { name: 'Phases of this day' }).click();
      const legend = page.getByRole('dialog', { name: 'Phases of this day' });
      await expect(legend.getByText(name)).toBeVisible();
      await expect(legend.getByText('22:00–02:00')).toBeVisible();
      await page.keyboard.press('Escape');
      // The grid tints the 22:00 hour with the phase color; the hour row itself is there.
      await expect(page.getByText('22:00', { exact: true }).first()).toBeAttached();
    } finally {
      await apiJson(request, auth.onboarded.access_token, 'delete', `/phases/${created.body.id}`);
    }
  });
});
