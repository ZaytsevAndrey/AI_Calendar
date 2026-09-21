import { test, expect, openAs, apiJson, expectOk, uniqueName, completeOpenTasks, stripBlock, skippableStripCard, waitForScheduleJob, deleteUnusedTimePhases } from '../helpers/fixtures';

async function generateSchedule(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Schedule' }).click();
  await page.getByRole('menuitem', { name: 'Generate schedule' }).click();
  await page
    .getByLabel('Schedule generation progress')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => undefined);
  await expect(page.getByText(/Schedule generated/)).toBeVisible({ timeout: 60_000 });
}

test.describe('P0 calendar UI', () => {
  test.describe('U-CAL-003 day-click window', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('empty Day slot prefills From/Until in Settings TZ', async ({ page, auth, request }) => {
      await deleteUnusedTimePhases(request, auth.onboarded.access_token);
      await openAs(page, auth.onboarded);
      await page.getByRole('button', { name: 'Day', exact: true }).click();
      await page.locator('[role="button"]', { hasText: '08:00' }).first().click({ force: true });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const ymd = await page.evaluate(() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      });
      await expect(dialog.locator('#task-form-from')).toHaveValue(`${ymd}T00:00`);
      await expect(dialog.locator('#task-form-deadline')).toHaveValue(`${ymd}T23:59`);
      await expect(dialog.getByText(/Times use Europe\/Kyiv/)).toBeVisible();
    });
  });

  test('U-CAL-005 undo last generate after confirm', async ({ page, auth, request }) => {
    test.setTimeout(90_000);
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name: uniqueName('E2E undo seed'),
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      allowSplit: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded);
    await generateSchedule(page);

    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Undo last generate' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Undo last generate' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Undo generate' }).click();
    await expect(page.getByText('Last generate undone')).toBeVisible();
  });

  test('U-CAL-006 clear schedule after confirm', async ({ page, auth, request }) => {
    test.setTimeout(90_000);
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name: uniqueName('E2E clear seed'),
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      allowSplit: true,
    });
    expectOk(created);

    await openAs(page, auth.onboarded);
    await generateSchedule(page);

    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByRole('menuitem', { name: 'Clear schedule' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Clear schedule' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Clear schedule' }).click();
    await expect(page.getByText(/Schedule cleared|Nothing to clear/)).toBeVisible();
  });

  test('U-CAL-010/011 Now and Next show timed blocks', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const nowName = uniqueName('E2E now');
    const nextName = uniqueName('E2E next');
    const now = Date.now();
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name: nowName,
        eventType: 'fixed',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: new Date(now - 5 * 60_000).toISOString(),
        scheduledEndTime: new Date(now + 20 * 60_000).toISOString(),
        timeZone: 'Europe/Kyiv',
      }),
    );
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name: nextName,
        eventType: 'fixed',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: new Date(now + 45 * 60_000).toISOString(),
        scheduledEndTime: new Date(now + 75 * 60_000).toISOString(),
        timeZone: 'Europe/Kyiv',
      }),
    );

    await openAs(page, auth.onboarded);
    const nowCard = stripBlock(page, nowName);
    await expect(nowCard).toBeVisible();
    await expect(nowCard.getByRole('button', { name: 'Done' })).toHaveCount(1);

    const nextCard = stripBlock(page, nextName);
    await expect(nextCard).toBeVisible();
  });

  test('U-CAL-012 flexible without a slot today appears in strip Unscheduled', async ({
    page,
    auth,
    request,
  }) => {
    const name = uniqueName('E2E waiting');
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name,
        eventType: 'admin',
        estimatedTimeInMinutes: 1440,
        allowSplit: false,
        isUnscheduled: false,
        timeZone: 'Europe/Kyiv',
      }),
    );

    await openAs(page, auth.onboarded);
    const inbox = page
      .locator('div')
      .filter({ has: page.getByText('Unscheduled', { exact: true }) })
      .filter({ hasText: name })
      .first();
    await expect(inbox).toBeVisible();
  });

  test('U-CAL-014 recurring and external Google blocks have no Done', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const recurringName = uniqueName('E2E series');
    const now = Date.now();
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name: recurringName,
        eventType: 'admin',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        recurrenceWeekDays: [0, 1, 2, 3, 4, 5, 6],
        estimatedTimeInMinutes: 30,
        timeZone: 'Europe/Kyiv',
      }),
    );

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
              id: 'ext-google-dentist',
              summary: 'External dentist',
              start: { dateTime: new Date(now - 5 * 60_000).toISOString() },
              end: { dateTime: new Date(now + 20 * 60_000).toISOString() },
              isAppGenerated: false,
            },
          ],
          totalEvents: 1,
        }),
      });
    });

    await openAs(page, auth.onboarded);
    const recurringBlock = stripBlock(page, recurringName);
    await expect(recurringBlock).toBeVisible();
    await expect(recurringBlock.getByRole('button', { name: 'Done' })).toHaveCount(0);

    const externalBlock = stripBlock(page, 'External dentist');
    await expect(externalBlock).toBeVisible();
    await expect(externalBlock.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(externalBlock.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  });

  test('U-CAL-019 Now Skip drops a movable timed slot without completing', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const name = uniqueName('E2E skip now');
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    const end = new Date(Date.now() + 25 * 60_000).toISOString();
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: start,
      scheduledEndTime: end,
      timeZone: 'Europe/Kyiv',
    });
    expectOk(created);
    await waitForScheduleJob(request, auth.onboarded.access_token, created.body.jobId);
    const placed = await apiJson(request, auth.onboarded.access_token, 'get', `/tasks/${created.body.id}`);
    expectOk(placed);
    if (!placed.body.scheduledStartTime || !placed.body.scheduledEndTime) {
      expectOk(
        await apiJson(request, auth.onboarded.access_token, 'post', '/schedule', {
          taskId: created.body.id,
          scheduledStartTime: start,
          scheduledEndTime: end,
        }),
      );
    }

    await openAs(page, auth.onboarded);
    const skipCard = skippableStripCard(page, name);
    await expect(skipCard).toBeVisible();
    await skipCard.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText('Occurrence skipped')).toBeVisible();
    await expect(skipCard).toHaveCount(0);

    const listed = await apiJson(request, auth.onboarded.access_token, 'get', `/tasks/${created.body.id}`);
    expectOk(listed);
    expect(listed.body.status).toBe('todo');
    expect(listed.body.scheduledStartTime == null).toBeTruthy();
  });

  test('U-CAL-020 recurring Now block has Skip and no Done', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const name = uniqueName('E2E skip series');
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    const end = new Date(Date.now() + 25 * 60_000).toISOString();
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name,
        eventType: 'admin',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        recurrenceWeekDays: [0, 1, 2, 3, 4, 5, 6],
        estimatedTimeInMinutes: 30,
        scheduledStartTime: start,
        scheduledEndTime: end,
        timeZone: 'Europe/Kyiv',
      }),
    );

    await openAs(page, auth.onboarded);
    const nowCard = stripBlock(page, name);
    await expect(nowCard).toBeVisible();
    await expect(nowCard.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(nowCard.getByRole('button', { name: 'Skip' })).toHaveCount(1);
  });
});
