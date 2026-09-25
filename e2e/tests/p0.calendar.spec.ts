import { test, expect, openAs, apiJson, expectOk, uniqueName, completeOpenTasks, stripBlock, skippableStripCard, waitForScheduleJob, deleteUnusedTimePhases } from '../helpers/fixtures';
import type { APIRequestContext } from '@playwright/test';

const KYIV = 'Europe/Kyiv';

function zonedParts(ms: number, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  return bag;
}

function kyivDayEndMs(ms: number): number {
  const p = zonedParts(ms, KYIV);
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ymd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return zonedClockToUtc(ymd, 0, 0, KYIV);
}

function zonedClockToUtc(ymd: string, hour: number, minute: number, timeZone: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const p = zonedParts(utcGuess, timeZone);
  let gotHour = Number(p.hour);
  let gotDay = Number(p.day);
  if (gotHour === 24) {
    gotHour = 0;
    gotDay += 1;
  }
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, gotDay, gotHour, Number(p.minute), Number(p.second));
  return utcGuess - (asUtc - utcGuess);
}

function clockMinutes(ms: number): number {
  const p = zonedParts(ms, KYIV);
  let hour = Number(p.hour);
  if (hour === 24) hour = 0;
  return hour * 60 + Number(p.minute);
}

function formatHm(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Wake/sleep that contains now and the next 45 minutes, including across midnight. */
function awakeWindowAround(nowMs: number): { wakeTime: string; sleepTime: string } {
  const nowMin = clockMinutes(nowMs);
  const start = nowMin - 5;
  const end = nowMin + 45;
  if (start >= 0 && end < 1440) {
    return { wakeTime: formatHm(start), sleepTime: formatHm(end) };
  }
  if (start < 0) {
    return { wakeTime: '00:00', sleepTime: formatHm(Math.max(end, 45)) };
  }
  return { wakeTime: formatHm(start), sleepTime: formatHm(end) };
}

async function releaseCompletedFixedBlocks(request: APIRequestContext, token: string): Promise<void> {
  const listed = await apiJson(request, token, 'get', '/tasks');
  expectOk(listed);
  const tasks = Array.isArray(listed.body) ? listed.body : [];
  for (const task of tasks) {
    if (!task?.id || task.eventType !== 'fixed') continue;
    if (task.status !== 'completed' && task.status !== 'canceled') continue;
    if (!task.scheduledStartTime && !task.scheduledEndTime) continue;
    expectOk(
      await apiJson(request, token, 'patch', `/tasks/${task.id}`, {
        eventType: 'admin',
        scheduledStartTime: null,
        scheduledEndTime: null,
      }),
    );
  }
}

async function pinAwakeAroundNow(
  request: APIRequestContext,
  token: string,
  nowMs: number,
): Promise<() => Promise<void>> {
  const settings = await apiJson(request, token, 'get', '/user-settings');
  expectOk(settings);
  const phases = await apiJson(request, token, 'get', '/phases');
  expectOk(phases);
  const list = Array.isArray(phases.body) ? phases.body : [];
  const focus = list.find((phase) => phase?.name === 'Focus hours');
  const window = awakeWindowAround(nowMs);
  expectOk(
    await apiJson(request, token, 'patch', '/user-settings', {
      wakeTime: window.wakeTime,
      sleepTime: window.sleepTime,
    }),
  );
  if (focus?.id) {
    expectOk(
      await apiJson(request, token, 'patch', `/phases/${focus.id}`, {
        startTime: window.wakeTime,
        endTime: window.sleepTime,
      }),
    );
  }
  return async () => {
    await apiJson(request, token, 'patch', '/user-settings', {
      wakeTime: settings.body.wakeTime,
      sleepTime: settings.body.sleepTime,
    });
    if (focus?.id) {
      await apiJson(request, token, 'patch', `/phases/${focus.id}`, {
        startTime: focus.startTime,
        endTime: focus.endTime,
      });
    }
  };
}

async function generateSchedule(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Schedule' }).click();
  await page.getByRole('menuitem', { name: 'Generate schedule' }).click();
  const preview = page.getByRole('dialog').filter({ hasText: 'Generate preview' });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await preview.getByRole('button', { name: 'Apply generate' }).click();
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
      await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const slot = page.getByRole('button', { name: '08:00', exact: true });
      await slot.evaluate((node) => {
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
        (node as HTMLElement).click();
      });
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
    const dayEnd = kyivDayEndMs(now);
    let nextStart = now + 45 * 60_000;
    let nextEnd = now + 75 * 60_000;
    if (nextStart >= dayEnd) {
      nextStart = Math.min(now + 60_000, dayEnd - 1000);
      nextEnd = nextStart + 15 * 60_000;
    }
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
        scheduledStartTime: new Date(nextStart).toISOString(),
        scheduledEndTime: new Date(nextEnd).toISOString(),
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
    const dayEnd = kyivDayEndMs(now);
    let seriesStart = now + 20 * 60_000;
    if (seriesStart >= dayEnd) seriesStart = Math.min(now + 2 * 60_000, dayEnd - 1000);
    if (seriesStart <= now) seriesStart = now + 1000;
    const seriesEnd = seriesStart + 15 * 60_000;
    const dentistEnd = Math.min(now + 8 * 60_000, seriesStart - 1000);
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name: recurringName,
      eventType: 'admin',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [0, 1, 2, 3, 4, 5, 6],
      estimatedTimeInMinutes: 30,
      scheduledStartTime: new Date(seriesStart).toISOString(),
      scheduledEndTime: new Date(seriesEnd).toISOString(),
      timeZone: 'Europe/Kyiv',
    });
    expectOk(created);
    await waitForScheduleJob(request, auth.onboarded.access_token, created.body.jobId);

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
              end: { dateTime: new Date(dentistEnd).toISOString() },
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
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);
    await releaseCompletedFixedBlocks(request, token);
    const nowMs = Date.now();
    const restoreAwake = await pinAwakeAroundNow(request, token, nowMs);
    const name = uniqueName('E2E skip now');
    try {
      const created = await apiJson(request, token, 'post', '/tasks', {
        name,
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        allowSplit: false,
        timeZone: 'Europe/Kyiv',
      });
      expectOk(created);
      await waitForScheduleJob(request, token, created.body.jobId);
      const placed = await apiJson(request, token, 'get', `/tasks/${created.body.id}`);
      expectOk(placed);
      expect(new Date(placed.body.scheduledStartTime).getTime()).toBeLessThanOrEqual(Date.now());
      expect(new Date(placed.body.scheduledEndTime).getTime()).toBeGreaterThan(Date.now());

      await openAs(page, auth.onboarded);
      const skipCard = skippableStripCard(page, name);
      await expect(skipCard).toBeVisible();
      await skipCard.getByRole('button', { name: 'Skip' }).click();
      await expect(page.getByText('Occurrence skipped')).toBeVisible();
      await expect(skipCard).toHaveCount(0);

      const listed = await apiJson(request, token, 'get', `/tasks/${created.body.id}`);
      expectOk(listed);
      expect(listed.body.status).toBe('todo');
      expect(listed.body.scheduledStartTime == null).toBeTruthy();
    } finally {
      await restoreAwake();
    }
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
