import { test, expect, openAs, apiJson, expectOk, uniqueName, completeOpenTasks, stripBlock } from '../helpers/fixtures';

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

  test('U-CAL-017 Schedule actions disable while generating', async ({ page, auth, request }) => {
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name: uniqueName('P1 busy gen'),
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      }),
    );
    await page.route('**/schedule/generate', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Generate schedule' }).click();
    const preview = page.getByRole('dialog').filter({ hasText: 'Generate preview' });
    await expect(preview).toBeVisible({ timeout: 60_000 });
    await preview.getByRole('button', { name: 'Apply generate' }).click();
    await expect(page.getByRole('button', { name: 'Schedule' })).toBeDisabled();
    await expect(page.getByText(/Schedule generated/)).toBeVisible({ timeout: 60_000 });
  });

  test('U-CAL-007 generate hang shows an error toast', async ({ page, auth }) => {
    await page.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      let extra = 0;
      Date.now = () => realNow() + extra;
      (window as unknown as { __e2eAddNow: (ms: number) => void }).__e2eAddNow = (ms) => {
        extra += ms;
      };
    });
    await page.route('**/schedule/generate', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'hang-job', status: 'pending' }),
      });
    });
    await page.route('**/schedule-jobs/hang-job', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'hang-job', status: 'pending', result: null }),
      });
    });

    await openAs(page, auth.onboarded);
    const polled = page.waitForResponse(
      (response) =>
        response.url().includes('/schedule-jobs/hang-job') && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Generate schedule' }).click();
    const preview = page.getByRole('dialog').filter({ hasText: 'Generate preview' });
    await expect(preview).toBeVisible({ timeout: 60_000 });
    await preview.getByRole('button', { name: 'Apply generate' }).click();
    await expect(page.getByLabel('Schedule generation progress')).toBeVisible();
    await polled;
    await page.evaluate(() => {
      (window as unknown as { __e2eAddNow: (ms: number) => void }).__e2eAddNow(130_000);
    });
    await expect(page.getByText('Schedule generation failed')).toBeVisible();
    await expect(page.getByText('Schedule job timed out')).toBeVisible();
    await expect(page.getByLabel('Schedule generation progress')).toHaveCount(0);
  });

  test('U-CAL-008 dismiss generate alerts persists across reload', async ({ page, auth }) => {
    const job = {
      id: 'alert-job-1',
      status: 'done',
      result: {
        diff: [],
        warnings: [{ code: 'CAPACITY', message: 'Could not fit overload task' }],
        errors: [],
      },
      updatedAt: new Date().toISOString(),
    };
    await page.route('**/schedule-jobs/latest/done', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job }),
      });
    });

    await openAs(page, auth.onboarded);
    const banner = page.getByLabel('Last generate notes');
    await expect(banner).toBeVisible();
    await expect(banner.getByText('Could not fit overload task')).toBeVisible();
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toHaveCount(0);
    const dismissed = await page.evaluate(() =>
      window.localStorage.getItem('scheduleGenerateAlertsDismissedJobId'),
    );
    expect(dismissed).toBe('alert-job-1');

    await page.reload();
    await expect(page.getByLabel('Last generate notes')).toHaveCount(0);
  });

  test('U-CAL-009 alerts older than 24h are not shown', async ({ page, auth }) => {
    const updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await page.route('**/schedule-jobs/latest/done', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'old-alert-job',
            status: 'done',
            result: {
              diff: [],
              warnings: [{ code: 'CAPACITY', message: 'Stale overload warning' }],
              errors: [],
            },
            updatedAt,
          },
        }),
      });
    });

    await openAs(page, auth.onboarded);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByText('Stale overload warning')).toHaveCount(0);
    await expect(page.getByLabel('Last generate notes')).toHaveCount(0);
  });

  test('U-CAL-021 generate preview lists moves and cancel does not apply', async ({ page, auth }) => {
    let generatePosts = 0;
    await page.route('**/schedule/preview', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          diff: [
            {
              taskId: 't1',
              taskName: 'Preview task',
              before: [],
              after: [
                {
                  start: '2026-04-20T09:00:00.000Z',
                  end: '2026-04-20T10:00:00.000Z',
                },
              ],
            },
          ],
          warnings: [
            {
              code: 'SCHEDULING_HORIZON_EXCEEDED',
              message: 'Task "Preview task" was placed outside the 30-day window.',
            },
          ],
          errors: [{ taskId: 't2', message: 'Cannot fit "Overflow" in the available window.' }],
        }),
      });
    });
    await page.route('**/schedule/generate', async (route) => {
      if (route.request().method() === 'POST') generatePosts += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });

    await openAs(page, auth.onboarded);
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Generate schedule' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Generate preview' });
    await expect(dialog.getByText('Preview task', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Cannot fit "Overflow" in the available window.')).toBeVisible();
    await expect(dialog.getByText(/outside the 30-day window/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(generatePosts).toBe(0);
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
