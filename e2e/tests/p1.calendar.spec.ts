import { test, expect, openAs, apiJson, completeOpenTasks, stripBlock } from '../helpers/fixtures';

test.describe('P1 calendar UI', () => {
  test('U-CAL-002 day week month and next/prev change the range', async ({ page, auth }) => {
    await openAs(page, auth.onboarded);
    const lead = page.locator('.page-lead');

    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const dayLead = await lead.textContent();
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(lead).not.toHaveText(dayLead || '');

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const weekLead = await lead.textContent();
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(lead).not.toHaveText(weekLead || '');

    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(lead).toContainText(/\d{4}/);
    const monthLead = await lead.textContent();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(lead).not.toHaveText(monthLead || '');

    await page.getByRole('button', { name: /Go to date/ }).click();
    await expect(page.getByRole('dialog', { name: 'Choose date' })).toBeVisible();
  });

  test('U-CAL-016 suggestions stay read-only', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);

    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Suggestions' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Ideas for the next 7 days' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('Nothing to review yet. Add tasks or generate a schedule first.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('U-CAL-015 all-day Google event can occupy Now', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    await page.route('**/google-calendar/events**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              id: 'all-day-holiday',
              summary: 'All-day holiday',
              start: { date: '2020-01-01' },
              end: { date: '2099-01-01' },
              isAppGenerated: false,
            },
          ],
          totalEvents: 1,
        }),
      });
    });

    await openAs(page, auth.onboarded);
    const nowCard = stripBlock(page, 'All-day holiday');
    await expect(nowCard).toBeVisible();
    await expect(nowCard.getByRole('button', { name: 'Done' })).toHaveCount(0);
  });

  test('U-CAL-022 calendars menu hides a Google calendar on this page', async ({ page, auth, request }) => {
    await page.route('**/google-calendar/calendars', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'user@gmail.com', summary: 'Primary', primary: true, selected: true, accessRole: 'owner' },
          {
            id: 'holidays@group.v.calendar.google.com',
            summary: 'Holidays',
            selected: true,
            accessRole: 'reader',
          },
        ]),
      });
    });

    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Calendars' }).click();
    const dialog = page.getByRole('dialog', { name: 'Visible calendars' });
    await expect(dialog.getByText('Holidays')).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Holidays' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Holidays' })).not.toBeChecked();

    await expect.poll(async () => {
      const saved = await apiJson(request, auth.onboarded.access_token, 'get', '/user-settings');
      return saved.body.hiddenGoogleCalendarIds;
    }).toEqual(['holidays@group.v.calendar.google.com']);

    await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
      hiddenGoogleCalendarIds: [],
    });
  });
});
