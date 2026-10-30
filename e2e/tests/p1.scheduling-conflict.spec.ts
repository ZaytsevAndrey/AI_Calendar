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
  problematicRegion,
  pickDayRange,
} from '../helpers/fixtures';

/** Europe/Kyiv offset (`+02:00` / `+03:00`) in effect at that wall clock — DST-aware. */
function kyivOffset(ymd: string, hm: string): string {
  const guess = new Date(`${ymd}T${hm}:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' })
    .formatToParts(guess)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = name?.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return match ? `${match[1]}:${match[2] ?? '00'}` : '+02:00';
}

function kyivWallIso(ymd: string, hm: string): string {
  return `${ymd}T${hm}:00${kyivOffset(ymd, hm)}`;
}

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
    if (new Date(kyivWallIso(ymd, '09:00')).getTime() > now) return ymd;
  }
  throw new Error('no free Kyiv morning in the next 14 days');
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
    // Preferred clock and dates live behind «Refine»; the window is that one day.
    await dialog.getByRole('button', { name: /Refine/ }).click();
    await dialog.locator('#task-form-preferred-start').selectOption('09:00');
    await pickDayRange(page, dialog, 'task-form-dates', day);
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

    const banner = await problematicRegion(page);
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
    // Preferred clock and dates live behind «Refine»; the window is that one day.
    await dialog.getByRole('button', { name: /Refine/ }).click();
    await dialog.locator('#task-form-preferred-start').selectOption('09:00');
    await pickDayRange(page, dialog, 'task-form-dates', day);
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
    await nowCard.getByRole('button', { name: 'Done', exact: true }).click();
    await expectMutationProgressToast(page, name);
    await expect(stripBlock(page, name)).toHaveCount(0);
  });
});
