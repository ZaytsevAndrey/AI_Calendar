import {
  test,
  expect,
  openAs,
  apiJson,
  expectOk,
  uniqueName,
  completeOpenTasks,
  openCreateTaskDialog,
  expectMutationProgressToast,
  waitForScheduleJob,
} from '../helpers/fixtures';

test.describe('P1 tasks UI', () => {
  test.beforeEach(async ({ auth, request }) => {
    await apiJson(request, auth.onboarded.access_token, 'patch', '/user-settings', {
      googleCalendarLinked: true,
      wakeTime: '08:00',
      sleepTime: '23:00',
      timeZone: 'Europe/Kyiv',
    });
  });
  test('U-TSK-011 uncheck Fixed restores Allow split', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('button', { name: 'Fixed' }).click();
    await expect(dialog.getByLabel('Allow split')).toHaveCount(0);
    await dialog.getByLabel('Fixed time').uncheck();
    await expect(dialog.getByLabel('Allow split')).toBeChecked();
  });

  test('U-TSK-014 status filter matches scheduled list', async ({ page, auth, request }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);
    const stamp = Date.now();
    const activeName = `P1 ${stamp} active`;
    const doneName = `P1 ${stamp} done`;
    const canceledName = `P1 ${stamp} canceled`;
    // Explicit future clocks keep rows in Scheduled when hole-search would park them.
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 2);
    const ymd = day.toISOString().slice(0, 10);

    const seedScheduled = async (name: string, startHm: string, endHm: string) => {
      const created = await apiJson(request, token, 'post', '/tasks', {
        name,
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: `${ymd}T${startHm}:00.000Z`,
        scheduledEndTime: `${ymd}T${endHm}:00.000Z`,
      });
      expectOk(created);
      await waitForScheduleJob(request, token, created.body.jobId);
      return created.body.id as string;
    };

    await seedScheduled(activeName, '10:00', '10:30');
    const doneId = await seedScheduled(doneName, '11:00', '11:30');
    expectOk(
      await apiJson(request, token, 'patch', `/tasks/${doneId}`, {
        status: 'completed',
      }),
    );
    const canceledId = await seedScheduled(canceledName, '12:00', '12:30');
    expectOk(
      await apiJson(request, token, 'patch', `/tasks/${canceledId}`, {
        status: 'canceled',
      }),
    );
    await expect
      .poll(async () => {
        const listed = await apiJson(request, token, 'get', '/tasks');
        const row = (Array.isArray(listed.body) ? listed.body : []).find(
          (task: { id?: string }) => task.id === canceledId,
        );
        return {
          status: row?.status,
          unscheduled: !!row?.isUnscheduled,
        };
      })
      .toEqual({ status: 'canceled', unscheduled: false });

    await openAs(page, auth.onboarded, '/tasks');
    const scheduled = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Scheduled' }) });
    await page.getByLabel('Status').selectOption('active');
    await expect(scheduled.getByRole('heading', { name: activeName })).toBeVisible();
    await expect(scheduled.getByRole('heading', { name: doneName })).toHaveCount(0);

    await page.getByLabel('Status').selectOption('completed');
    await expect(scheduled.getByRole('heading', { name: doneName })).toBeVisible();
    await expect(scheduled.getByRole('heading', { name: activeName })).toHaveCount(0);

    await page.getByLabel('Status').selectOption('canceled');
    await expect(scheduled.getByRole('heading', { name: canceledName })).toBeVisible();

    await page.getByLabel('Status').selectOption('all');
    await expect(scheduled.getByRole('heading', { name: activeName })).toBeVisible();
    await expect(scheduled.getByRole('heading', { name: doneName })).toBeVisible();
    await expect(scheduled.getByRole('heading', { name: canceledName })).toBeVisible();
  });

  test('U-TSK-015 sort by name orders the scheduled list', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const stamp = Date.now();
    const bravo = `P1 ${stamp} Bravo`;
    const alpha = `P1 ${stamp} Alpha`;
    const charlie = `P1 ${stamp} Charlie`;
    for (const name of [bravo, alpha, charlie]) {
      expectOk(
        await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
          name,
          eventType: 'admin',
          estimatedTimeInMinutes: 30,
        }),
      );
    }

    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByLabel('Sort by').selectOption('name');
    const scheduled = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Scheduled' }) });
    await expect(scheduled.getByRole('heading', { level: 3 })).toHaveText([alpha, bravo, charlie]);
  });

  test('U-TSK-016/017 delete confirm cancel then confirm', async ({ page, auth, request }) => {
    const name = uniqueName('P1 delete me');
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name,
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      }),
    );

    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Delete task' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Delete task' }).getByRole('button', { name: 'Delete' }).click();
    await expectMutationProgressToast(page, name);
    await expect(page.getByRole('heading', { name })).toHaveCount(0);
  });

  test('U-TSK-018 failed create shows API error toast', async ({ page, auth }) => {
    await page.route('**/tasks', async (route) => {
      if (route.request().method() !== 'POST' || /\/tasks\/.+/.test(new URL(route.request().url()).pathname)) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'DB down' }),
      });
    });

    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('textbox', { name: /Name/ }).fill(uniqueName('P1 fail create'));
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Could not create task')).toBeVisible();
    await expect(page.getByText('DB down')).toBeVisible();
  });

  test('U-TSK-008 unscheduled card shows icon meta for phase, earliest, overdue', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    const phaseName = uniqueName('P1 inbox phase');
    const phase = await apiJson(request, token, 'post', '/phases', {
      name: phaseName,
      color: '#22aa66',
      startTime: '10:00',
      endTime: '12:00',
      weekDays: [1, 2, 3, 4, 5],
      type: 'time_phase',
    });
    expectOk(phase);
    const name = uniqueName('P1 overdue inbox');
    const earliest = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const deadline = new Date(Date.now() - 60 * 60_000).toISOString();
    expectOk(
      await apiJson(request, token, 'post', '/tasks', {
        name,
        isUnscheduled: true,
        phaseIds: [phase.body.id],
        earliestStartTime: earliest,
        deadline,
      }),
    );
    await openAs(page, auth.onboarded, '/tasks');
    const row = page.locator('.task-item').filter({ hasText: name });
    await expect(row.getByLabel('Unscheduled', { exact: true })).toBeVisible();
    await expect(row.getByLabel(phaseName, { exact: true })).toBeVisible();
    await expect(row.getByLabel(/^From /)).toBeVisible();
    await expect(row.getByLabel(/Overdue/)).toBeVisible();
    // Icon-only actions (aria-label), not desktop text pills for duration.
    await expect(row.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Do now' })).toBeVisible();
    await expect(row.getByText(/min/i)).toHaveCount(0);
  });

  test('U-TSK-012 edit can clear phase and deadline', async ({ page, auth, request }) => {
    const phaseName = uniqueName('P1 task phase');
    const phase = await apiJson(request, auth.onboarded.access_token, 'post', '/phases', {
      name: phaseName,
      color: '#22aa66',
      startTime: '10:00',
      endTime: '12:00',
      weekDays: [1, 2, 3, 4, 5],
      type: 'time_phase',
    });
    expectOk(phase);
    const name = uniqueName('P1 clear phase');
    const created = await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
      name,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      phaseIds: [phase.body.id],
      deadline: '2030-06-15T18:00:00+03:00',
    });
    expectOk(created);

    await openAs(page, auth.onboarded, '/tasks');
    const patches: Array<Record<string, unknown>> = [];
    await page.route('**/tasks/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        patches.push((route.request().postDataJSON() || {}) as Record<string, unknown>);
      }
      await route.continue();
    });
    const row = page.locator('.task-item').filter({ hasText: name });
    await row.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Edit task')).toBeVisible();
    await dialog.locator('#task-form-phase').selectOption({ label: 'Any time' });
    await expect(dialog.locator('#task-form-phase')).toHaveValue('');
    await dialog.locator('#task-form-deadline').fill('');
    await expect(dialog.locator('#task-form-deadline')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expectMutationProgressToast(page, name);
    expect(patches[0]?.phaseIds).toEqual([]);
    expect(patches[0]?.deadline).toBeNull();

    const saved = await apiJson(request, auth.onboarded.access_token, 'get', `/tasks/${created.body.id}`);
    expectOk(saved);
    expect(saved.body.deadline ?? null).toBeNull();
    // UI sends phaseIds: []; GET still returns the previous phaseId.
    expect(saved.body.phaseId).toBe(phase.body.id);
  });

  test('U-TSK-013 Google event options persist', async ({ page, auth, request }) => {
    const name = uniqueName('P1 google opts');
    await openAs(page, auth.onboarded, '/tasks');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('textbox', { name: /Name/ }).fill(name);
    await dialog.getByRole('button', { name: '+ More options' }).click();
    await dialog.locator('#google-event-location').fill('Office 4');
    await dialog.getByRole('button', { name: 'Tomato' }).click();
    await dialog.locator('#google-event-visibility').selectOption('private');
    await dialog.getByLabel('Use calendar defaults').uncheck();
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expectMutationProgressToast(page, name);

    const listed = await apiJson(request, auth.onboarded.access_token, 'get', '/tasks');
    expectOk(listed);
    const task = (listed.body as Array<{ name: string; location?: string; googleColorId?: string; googleVisibility?: string; googleReminders?: { useDefault?: boolean } }>).find(
      (item) => item.name === name,
    );
    expect(task?.location).toBe('Office 4');
    expect(task?.googleColorId).toBe('11');
    expect(task?.googleVisibility).toBe('private');
    expect(task?.googleReminders?.useDefault).toBe(false);
  });

  test('U-TSK-020 search in one section leaves the other list alone', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const stamp = Date.now();
    const inboxName = `P1 ${stamp} inbox milk`;
    const scheduledName = `P1 ${stamp} plan milk`;
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name: inboxName,
        isUnscheduled: true,
      }),
    );
    expectOk(
      await apiJson(request, auth.onboarded.access_token, 'post', '/tasks', {
        name: scheduledName,
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
      }),
    );

    await openAs(page, auth.onboarded, '/tasks');
    const unscheduled = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Unscheduled' }) });
    const scheduled = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Scheduled' }) });

    await page.getByLabel('Search unscheduled').fill('inbox');
    await expect(unscheduled.getByRole('heading', { name: inboxName })).toBeVisible();
    await expect(scheduled.getByRole('heading', { name: scheduledName })).toBeVisible();

    await page.getByLabel('Search scheduled').fill('plan');
    await expect(scheduled.getByRole('heading', { name: scheduledName })).toBeVisible();
    await page.getByLabel('Search scheduled').fill('inbox');
    await expect(scheduled.getByRole('heading', { name: scheduledName })).toHaveCount(0);
    await expect(unscheduled.getByRole('heading', { name: inboxName })).toBeVisible();
  });
});
