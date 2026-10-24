import {
  test,
  expect,
  openAs,
  apiJson,
  expectOk,
  uniqueName,
  completeOpenTasks,
  openCreateTaskDialog,
  waitForScheduleJob,
  expectMutationProgressToast,
  stripBlock,
} from '../helpers/fixtures';

/** First Europe/Kyiv civil day whose 09:00 is still in the future. */
function kyivFirstFreeMorningYmd(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = Date.now();
  for (let offset = 0; offset < 14; offset += 1) {
    const ymd = fmt.format(new Date(now + offset * 24 * 60 * 60 * 1000));
    // 09:00 Kyiv ≈ 06:00 UTC (winter) / 06:00–07:00 depending on DST.
    const probe = new Date(`${ymd}T09:00:00+03:00`).getTime();
    if (probe > now) return ymd;
  }
  throw new Error('no free Kyiv morning in the next 14 days');
}

function kyivWallIso(ymd: string, hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  // Build offset-aware local via Intl: prefer +03 for e2e stability with onboarded TZ.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ymd}T${pad(h)}:${pad(m)}:00+03:00`;
}

test.describe('P1 scheduling conflict (real placement, JWT openAs)', () => {
  test('U-SCH-001 create preferred on fixed opens conflict sheet; dismiss parks Problematic (C01)', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);

    const phaseName = uniqueName('P1 conflict phase');
    const phase = await apiJson(request, token, 'post', '/phases', {
      name: phaseName,
      color: '#228866',
      startTime: '09:00',
      endTime: '12:00',
      weekDays: [1, 2, 3, 4, 5, 6, 7],
      type: 'time_phase',
    });
    expectOk(phase);
    const phaseId = phase.body.id as string;
    const day = kyivFirstFreeMorningYmd();

    const fixedName = uniqueName('P1 fixed wall');
    const fixed = await apiJson(request, token, 'post', '/tasks', {
      name: fixedName,
      eventType: 'fixed',
      estimatedTimeInMinutes: 60,
      phaseId,
      scheduledStartTime: kyivWallIso(day, '09:00'),
      scheduledEndTime: kyivWallIso(day, '10:00'),
      timeZone: 'Europe/Kyiv',
    });
    expectOk(fixed);
    await waitForScheduleJob(request, token, fixed.body?.jobId);

    await openAs(page, auth.onboarded);
    const claimName = uniqueName('P1 claim preferred');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('textbox', { name: /Name/ }).fill(claimName);
    await dialog
      .locator('#task-form-phase')
      .getByRole('option', { name: phaseName })
      .click();
    await dialog.locator('#task-form-preferred-start').selectOption('09:00');
    await dialog.locator('#task-form-from').fill(`${day}T08:00`);
    await dialog.getByRole('button', { name: 'Create task' }).click();

    const conflict = page.getByRole('dialog').filter({ hasText: 'Schedule conflict' });
    await expect(conflict).toBeVisible({ timeout: 30_000 });
    await expect(conflict.getByText(claimName)).toBeVisible();
    await expect(
      conflict.getByRole('button', { name: /Place this task elsewhere/ }),
    ).toBeVisible();
    await expect(
      conflict.getByRole('button', { name: /Keep this time on top of others/ }),
    ).toBeVisible();

    await conflict.getByRole('button', { name: 'Park as problematic', exact: true }).last().click();
    await expect(conflict).toBeHidden({ timeout: 15_000 });

    const banner = page.getByRole('region', {
      name: 'Tasks that fell out of the schedule',
    });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.getByRole('button', { name: 'Review' }).click();
    const inbox = page.getByRole('dialog', { name: 'Problematic' });
    await expect(inbox).toBeVisible();
    await expect(inbox.getByText(claimName)).toBeVisible();
  });

  test('U-SCH-002 create preferred on fixed → Place elsewhere seats off the wall', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);

    const phaseName = uniqueName('P1 move-new phase');
    const phase = await apiJson(request, token, 'post', '/phases', {
      name: phaseName,
      color: '#226688',
      startTime: '09:00',
      endTime: '12:00',
      weekDays: [1, 2, 3, 4, 5, 6, 7],
      type: 'time_phase',
    });
    expectOk(phase);
    const phaseId = phase.body.id as string;
    const day = kyivFirstFreeMorningYmd();

    const fixed = await apiJson(request, token, 'post', '/tasks', {
      name: uniqueName('P1 wall B'),
      eventType: 'fixed',
      estimatedTimeInMinutes: 60,
      phaseId,
      scheduledStartTime: kyivWallIso(day, '09:00'),
      scheduledEndTime: kyivWallIso(day, '10:00'),
      timeZone: 'Europe/Kyiv',
    });
    expectOk(fixed);
    await waitForScheduleJob(request, token, fixed.body?.jobId);

    await openAs(page, auth.onboarded);
    const claimName = uniqueName('P1 move new');
    const dialog = await openCreateTaskDialog(page);
    await dialog.getByRole('textbox', { name: /Name/ }).fill(claimName);
    await dialog
      .locator('#task-form-phase')
      .getByRole('option', { name: phaseName })
      .click();
    await dialog.locator('#task-form-preferred-start').selectOption('09:00');
    await dialog.locator('#task-form-from').fill(`${day}T08:00`);
    await dialog.getByRole('button', { name: 'Create task' }).click();

    const conflict = page.getByRole('dialog').filter({ hasText: 'Schedule conflict' });
    await expect(conflict).toBeVisible({ timeout: 30_000 });
    await conflict.getByRole('button', { name: /Place this task elsewhere/ }).click();
    await expect(conflict).toBeHidden({ timeout: 20_000 });
    await expectMutationProgressToast(page, claimName);

    let seated: {
      scheduleState: string;
      scheduledStartTime: string | null;
    } | null = null;
    for (let i = 0; i < 40; i += 1) {
      const listed = await apiJson(request, token, 'get', '/tasks');
      expectOk(listed);
      const row = (
        listed.body as Array<{
          name: string;
          scheduleState: string;
          scheduledStartTime: string | null;
        }>
      ).find((t) => t.name === claimName);
      if (row?.scheduledStartTime) {
        seated = row;
        break;
      }
      await page.waitForTimeout(250);
    }
    expect(seated).toBeTruthy();
    expect(seated!.scheduleState).not.toBe('problematic');
    expect(Date.parse(seated!.scheduledStartTime!)).not.toBe(
      Date.parse(kyivWallIso(day, '09:00')),
    );
  });

  test('U-SCH-003 daily loop: create seats → Done clears Now strip', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);

    const name = uniqueName('P1 loop now');
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    const end = new Date(Date.now() + 25 * 60_000).toISOString();
    const created = await apiJson(request, token, 'post', '/tasks', {
      name,
      eventType: 'fixed',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: start,
      scheduledEndTime: end,
      timeZone: 'Europe/Kyiv',
    });
    expectOk(created);
    await waitForScheduleJob(request, token, created.body?.jobId);

    await openAs(page, auth.onboarded);
    const nowCard = stripBlock(page, name);
    await expect(nowCard).toBeVisible({ timeout: 15_000 });
    await nowCard.hover();
    await nowCard.getByRole('button', { name: 'Done' }).click();
    await expectMutationProgressToast(page, name);
    await expect(stripBlock(page, name)).toHaveCount(0);
  });
});
