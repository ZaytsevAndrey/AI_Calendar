import { test, expect, openAs, apiJson, expectOk, uniqueName, completeOpenTasks } from '../helpers/fixtures';

async function seedProblematic(
  request: Parameters<typeof apiJson>[0],
  token: string,
  opts?: { ymd?: string; minutes?: number; name?: string },
) {
  const placeYmd = opts?.ymd ?? '2026-10-06';
  const name = opts?.name ?? uniqueName('P1 problematic');
  const created = await apiJson(request, token, 'post', '/tasks', {
    name,
    eventType: 'admin',
    estimatedTimeInMinutes: opts?.minutes ?? 30,
    scheduleState: 'problematic',
    problematicReason: 'phase_full',
    problematicOccurrenceYmds: [placeYmd],
  });
  expectOk(created);
  return { name, placeYmd, taskId: created.body.id as string };
}

async function openMoveSheet(
  page: import('@playwright/test').Page,
  auth: { onboarded: { access_token: string } },
  name: string,
) {
  await openAs(page, auth.onboarded);
  const banner = page.getByRole('region', { name: 'Tasks that fell out of the schedule' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Review' }).click();
  const inbox = page.getByRole('dialog', { name: 'Problematic' });
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText(name)).toBeVisible();
  await inbox.getByRole('button', { name: 'Move', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Move' });
  await expect(move).toBeVisible();
  return { inbox, move };
}

test.describe('P1 Problematic Move slot pick (U-CAL-025+)', () => {
  test('U-CAL-025a banner Review opens the problematic inbox', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token);
    await openAs(page, auth.onboarded);
    const banner = page.getByRole('region', { name: 'Tasks that fell out of the schedule' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Review' }).click();
    const inbox = page.getByRole('dialog', { name: 'Problematic' });
    await expect(inbox).toBeVisible();
    await expect(inbox.getByText(name)).toBeVisible();
  });

  test('U-CAL-025b Move has day, phase, and start-time fields', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name, placeYmd } = await seedProblematic(
      request,
      auth.onboarded.access_token,
    );
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByLabel('Day')).toHaveValue(placeYmd);
    await expect(move.getByLabel('Phase')).toBeVisible();
    await expect(move.locator('input[type="time"]')).toBeVisible();
    await expect(move.locator('input[type="time"]')).toHaveCount(1);
  });

  test('U-CAL-025c snap timeline listbox appears with slot options', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token);
    const { move } = await openMoveSheet(page, auth, name);
    const slotList = move.getByRole('listbox', { name: /Available slots/i });
    await expect(slotList).toBeVisible({ timeout: 30_000 });
    await expect(slotList.getByRole('option').first()).toBeAttached();
    await expect(move.getByRole('button', { name: 'Place' })).toBeEnabled({
      timeout: 15_000,
    });
  });

  test('U-CAL-025d Place clears problematic and sets fixed times', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name, placeYmd, taskId } = await seedProblematic(
      request,
      auth.onboarded.access_token,
      { ymd: '2026-10-09' },
    );
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('listbox')).toBeVisible({ timeout: 30_000 });
    await move.getByRole('button', { name: 'Place' }).click();
    await expect(page.getByText('Placed on the calendar')).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => {
        const listed = await apiJson(request, auth.onboarded.access_token, 'get', '/tasks');
        const task = (Array.isArray(listed.body) ? listed.body : []).find(
          (row: { id?: string }) => row.id === taskId,
        );
        return {
          scheduleState: task?.scheduleState,
          eventType: task?.eventType,
          start: String(task?.scheduledStartTime || ''),
        };
      })
      .toMatchObject({
        scheduleState: 'none',
        eventType: 'fixed',
      });
    await expect
      .poll(async () => {
        const listed = await apiJson(request, auth.onboarded.access_token, 'get', '/tasks');
        const task = (Array.isArray(listed.body) ? listed.body : []).find(
          (row: { id?: string }) => row.id === taskId,
        );
        return String(task?.scheduledStartTime || '');
      })
      .toMatch(new RegExp(`^${placeYmd}T`));
  });

  test('U-CAL-025e Cancel closes the Move sheet without placing', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name, taskId } = await seedProblematic(
      request,
      auth.onboarded.access_token,
      { ymd: '2026-10-10' },
    );
    const { move } = await openMoveSheet(page, auth, name);
    await move.getByRole('button', { name: 'Cancel' }).click();
    await expect(move).toBeHidden();
    const listed = await apiJson(request, auth.onboarded.access_token, 'get', '/tasks');
    const task = (Array.isArray(listed.body) ? listed.body : []).find(
      (row: { id?: string }) => row.id === taskId,
    );
    expect(task?.scheduleState).toBe('problematic');
    expect(task?.scheduledStartTime == null || task?.eventType !== 'fixed').toBe(true);
  });

  test('U-CAL-025f changing day refetches free-slots', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name, placeYmd } = await seedProblematic(
      request,
      auth.onboarded.access_token,
      { ymd: '2026-10-11' },
    );
    const ymds: string[] = [];
    await page.route('**/schedule/free-slots**', async (route) => {
      const url = new URL(route.request().url());
      ymds.push(url.searchParams.get('ymd') || '');
      await route.continue();
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('listbox')).toBeVisible({ timeout: 30_000 });
    await move.getByLabel('Day').fill('2026-10-12');
    await expect.poll(() => ymds.includes('2026-10-12')).toBe(true);
    expect(ymds[0]).toBe(placeYmd);
  });

  test('U-CAL-025g empty candidates shows empty-state copy', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-13',
      minutes: 30,
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ymd: '2026-10-13',
          timeZone: 'Europe/Kyiv',
          durationMinutes: 30,
          dayStart: '2026-10-13T04:00:00.000Z',
          dayEnd: '2026-10-13T19:00:00.000Z',
          phase: null,
          busy: [],
          free: [],
          candidates: [],
        }),
      });
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(
      move.getByText(/No free slot big enough on this day and phase/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(move.getByRole('button', { name: 'Place' })).toBeDisabled();
  });

  test('U-CAL-025h free-slots load error surfaces in the sheet', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-14',
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'boom' }),
      });
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByText(/Could not load free slots/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('U-CAL-025i free-slots loads without phaseId; phase select seeks timeline', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const phase = await apiJson(request, auth.onboarded.access_token, 'post', '/phases', {
      name: uniqueName('Move phase'),
      color: '#2266aa',
      startTime: '10:00',
      endTime: '16:00',
      type: 'time_phase',
    });
    expectOk(phase);
    const phaseId = phase.body.id as string;
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-15',
    });
    const phaseIds: string[] = [];
    await page.route('**/schedule/free-slots**', async (route) => {
      const url = new URL(route.request().url());
      phaseIds.push(url.searchParams.get('phaseId') || '');
      await route.continue();
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('listbox')).toBeVisible({ timeout: 30_000 });
    // Full-day fetch — no phase filter on the API.
    expect(phaseIds.every((id) => id === '')).toBe(true);
    const before = phaseIds.length;
    await move.getByLabel('Phase').selectOption(phaseId);
    await expect(move.getByLabel('Phase')).toHaveValue(phaseId);
    // Selecting a phase must not refetch free-slots with that phaseId.
    await page.waitForTimeout(300);
    expect(phaseIds.slice(before).every((id) => id === '')).toBe(true);
  });

  test('U-CAL-025j wheel-scrolling the timeline does not snap back to the start', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-16',
    });
    const { move } = await openMoveSheet(page, auth, name);
    const slotList = move.getByRole('listbox', { name: /Available slots/i });
    await expect(slotList).toBeVisible({ timeout: 30_000 });
    await expect(slotList.getByRole('option').first()).toBeAttached();

    const box = await slotList.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(40);
    }

    const scrollTopAfterWheel = await slotList.evaluate((el) => el.scrollTop);
    expect(scrollTopAfterWheel).toBeGreaterThan(80);

    await page.waitForTimeout(600);
    const scrollTopLater = await slotList.evaluate((el) => el.scrollTop);
    // Must not yank back near 0 (the old auto-snap / scrollIntoView bug).
    expect(scrollTopLater).toBeGreaterThan(80);
    expect(Math.abs(scrollTopLater - scrollTopAfterWheel)).toBeLessThan(60);

    const modalBodyScroll = await move.evaluate((el) => {
      let node: HTMLElement | null = el;
      while (node) {
        if (node.scrollHeight > node.clientHeight + 2) {
          return node.scrollTop;
        }
        node = node.parentElement;
      }
      return 0;
    });
    expect(modalBodyScroll).toBeLessThan(40);
  });

  test('U-CAL-025k shows from–to range and disables Place over a busy gap', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-17',
      minutes: 30,
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ymd: '2026-10-17',
          timeZone: 'UTC',
          durationMinutes: 30,
          dayStart: '2026-10-17T06:00:00.000Z',
          dayEnd: '2026-10-17T18:00:00.000Z',
          phase: null,
          busy: [
            {
              start: '2026-10-17T10:00:00.000Z',
              end: '2026-10-17T16:00:00.000Z',
            },
          ],
          free: [
            {
              start: '2026-10-17T06:00:00.000Z',
              end: '2026-10-17T10:00:00.000Z',
            },
            {
              start: '2026-10-17T16:00:00.000Z',
              end: '2026-10-17T18:00:00.000Z',
            },
          ],
          candidates: [
            '2026-10-17T06:00:00.000Z',
            '2026-10-17T07:00:00.000Z',
            '2026-10-17T08:00:00.000Z',
            '2026-10-17T09:00:00.000Z',
            '2026-10-17T16:00:00.000Z',
            '2026-10-17T16:30:00.000Z',
          ],
        }),
      });
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('listbox', { name: /Available slots/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(move.getByText(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/).first()).toBeVisible();
    await expect(move.getByRole('button', { name: 'Place' })).toBeEnabled({
      timeout: 15_000,
    });

    // Manual seek into the busy band — must not soft-snap back onto a free slot.
    await move.locator('input[type="time"]').fill('12:00');
    await expect(move.getByText(/12:00\s*[–-]\s*12:30/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByText(/Busy — can't place here/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByRole('button', { name: 'Place' })).toBeDisabled();
  });

  test('U-CAL-025l Place stays enabled on a later free candidate', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-18',
      minutes: 30,
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ymd: '2026-10-18',
          timeZone: 'UTC',
          durationMinutes: 30,
          dayStart: '2026-10-18T09:00:00.000Z',
          dayEnd: '2026-10-18T17:00:00.000Z',
          phase: null,
          busy: [],
          free: [
            {
              start: '2026-10-18T09:00:00.000Z',
              end: '2026-10-18T17:00:00.000Z',
            },
          ],
          candidates: [
            '2026-10-18T09:00:00.000Z',
            '2026-10-18T09:15:00.000Z',
            '2026-10-18T10:00:00.000Z',
            '2026-10-18T11:00:00.000Z',
            '2026-10-18T12:00:00.000Z',
            '2026-10-18T14:00:00.000Z',
            '2026-10-18T15:00:00.000Z',
          ],
        }),
      });
    });
    const { move } = await openMoveSheet(page, auth, name);
    const slotList = move.getByRole('listbox', { name: /Available slots/i });
    await expect(slotList).toBeVisible({ timeout: 30_000 });
    await expect(move.getByRole('button', { name: 'Place' })).toBeEnabled();

    // Jump to a later candidate (14:00), not the initial morning slot.
    await slotList.getByRole('option').nth(5).click();
    await expect(move.getByText(/14:00\s*[–-]\s*14:30/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByRole('button', { name: 'Place' })).toBeEnabled();
    await expect(move.getByText(/Busy — can't place here/i)).toHaveCount(0);
  });

  test('U-CAL-025m manual start time seeks and can enable Place', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-19',
      minutes: 30,
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ymd: '2026-10-19',
          timeZone: 'UTC',
          durationMinutes: 30,
          dayStart: '2026-10-19T09:00:00.000Z',
          dayEnd: '2026-10-19T17:00:00.000Z',
          phase: null,
          busy: [],
          free: [
            {
              start: '2026-10-19T09:00:00.000Z',
              end: '2026-10-19T17:00:00.000Z',
            },
          ],
          candidates: [
            '2026-10-19T09:00:00.000Z',
            '2026-10-19T11:00:00.000Z',
            '2026-10-19T14:00:00.000Z',
            '2026-10-19T15:30:00.000Z',
          ],
        }),
      });
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('listbox')).toBeVisible({ timeout: 30_000 });
    await move.locator('input[type="time"]').fill('14:00');
    await expect(move.getByText(/14:00\s*[–-]\s*14:30/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByRole('button', { name: 'Place' })).toBeEnabled();
  });

  test('U-CAL-025n scrolling into another phase updates the Phase select', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const token = auth.onboarded.access_token;
    // Isolate from lifestyle defaults / leftover phases so focus→phase is deterministic.
    const existing = await apiJson(request, token, 'get', '/phases');
    expectOk(existing);
    for (const row of Array.isArray(existing.body) ? existing.body : []) {
      if (row?.type === 'sleep_time' || !row?.id) continue;
      await apiJson(request, token, 'delete', `/phases/${row.id}`);
    }
    const morning = await apiJson(request, token, 'post', '/phases', {
      name: uniqueName('Morning'),
      color: '#11aa55',
      startTime: '09:00',
      endTime: '12:00',
      type: 'time_phase',
    });
    expectOk(morning);
    const afternoon = await apiJson(request, token, 'post', '/phases', {
      name: uniqueName('Afternoon'),
      color: '#aa5511',
      startTime: '14:00',
      endTime: '15:00',
      type: 'time_phase',
    });
    expectOk(afternoon);
    const afternoonId = afternoon.body.id as string;    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-20',
      minutes: 30,
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ymd: '2026-10-20',
          timeZone: 'UTC',
          durationMinutes: 30,
          dayStart: '2026-10-20T09:00:00.000Z',
          dayEnd: '2026-10-20T17:00:00.000Z',
          phase: null,
          busy: [],
          free: [
            {
              start: '2026-10-20T09:00:00.000Z',
              end: '2026-10-20T17:00:00.000Z',
            },
          ],
          candidates: [
            '2026-10-20T09:00:00.000Z',
            '2026-10-20T10:00:00.000Z',
            '2026-10-20T14:00:00.000Z',
            '2026-10-20T15:00:00.000Z',
          ],
        }),
      });
    });
    // Drop RTK phase cache so the new phases appear in the Phase select.
    await openAs(page, auth.onboarded);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Tasks that fell out of the schedule' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Review' }).click();
    const inbox = page.getByRole('dialog', { name: 'Problematic' });
    await inbox.getByRole('button', { name: 'Move', exact: true }).click();
    const move = page.getByRole('dialog', { name: 'Move' });
    await expect(move).toBeVisible();
    await expect(move.getByRole('listbox')).toBeVisible({ timeout: 30_000 });
    await expect(
      move.getByLabel('Phase').locator(`option[value="${afternoonId}"]`),
    ).toBeAttached({ timeout: 15_000 });
    await move.locator('input[type="time"]').fill('14:00');
    await expect
      .poll(async () => move.getByLabel('Phase').inputValue(), { timeout: 10_000 })
      .toBe(afternoonId);
  });

  test('U-CAL-025o Place toggles with manual time between free and busy', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: '2026-10-21',
      minutes: 30,
    });
    await page.route('**/schedule/free-slots**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ymd: '2026-10-21',
          timeZone: 'UTC',
          durationMinutes: 30,
          dayStart: '2026-10-21T09:00:00.000Z',
          dayEnd: '2026-10-21T17:00:00.000Z',
          phase: null,
          busy: [
            {
              start: '2026-10-21T12:00:00.000Z',
              end: '2026-10-21T15:00:00.000Z',
            },
          ],
          free: [
            {
              start: '2026-10-21T09:00:00.000Z',
              end: '2026-10-21T12:00:00.000Z',
            },
            {
              start: '2026-10-21T15:00:00.000Z',
              end: '2026-10-21T17:00:00.000Z',
            },
          ],
          candidates: [
            '2026-10-21T09:00:00.000Z',
            '2026-10-21T10:00:00.000Z',
            '2026-10-21T11:00:00.000Z',
            '2026-10-21T15:00:00.000Z',
            '2026-10-21T16:00:00.000Z',
          ],
        }),
      });
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('listbox')).toBeVisible({ timeout: 30_000 });
    const place = move.getByRole('button', { name: 'Place' });
    const time = move.locator('input[type="time"]');

    await time.fill('10:00');
    await expect(move.getByText(/10:00\s*[–-]\s*10:30/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(place).toBeEnabled();
    await expect(move.getByText(/Busy — can't place here/i)).toHaveCount(0);

    await time.fill('13:00');
    await expect(move.getByText(/13:00\s*[–-]\s*13:30/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByText(/Busy — can't place here/i)).toBeVisible();
    await expect(place).toBeDisabled();

    await time.fill('15:30');
    await expect(move.getByText(/15:30\s*[–-]\s*16:00/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(place).toBeEnabled();
    await expect(move.getByText(/Busy — can't place here/i)).toHaveCount(0);
  });
});
