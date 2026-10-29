import type { Locator, Page, Route } from '@playwright/test';
import { test, expect, openAs, apiJson, expectOk, uniqueName, completeOpenTasks } from '../helpers/fixtures';

/** The move sheet start time is a shared TimeField, not a native time input. */
async function setStartTime(page: Page, move: Locator, value: string) {
  const [hour, minute] = value.split(':');
  const trigger = move.getByRole('button', { name: 'Start time' });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  const list = page.getByRole('listbox', { name: 'Start time' });
  await list.getByRole('option', { name: hour, exact: true }).click();
  await list.getByRole('option', { name: minute, exact: true }).click();
  await page.keyboard.press('Escape');
}

/** Future civil days in Europe/Kyiv so park rows stay on the Problematic banner. */
function futureYmd(daysAhead: number, timeZone = 'Europe/Kyiv'): string {
  const instant = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

const Y = {
  d1: futureYmd(1),
  d2: futureYmd(2),
  d3: futureYmd(3),
  d4: futureYmd(4),
  d5: futureYmd(5),
  d6: futureYmd(6),
  d7: futureYmd(7),
  d8: futureYmd(8),
  d9: futureYmd(9),
  d10: futureYmd(10),
  d11: futureYmd(11),
  d12: futureYmd(12),
  d13: futureYmd(13),
  d14: futureYmd(14),
  d15: futureYmd(15),
};

const BUSY_TEXT = /Busy, cannot place here/i;
const range = (start: string, end: string) => new RegExp(`${start}\\s*[–-]\\s*${end}`);

async function seedProblematic(
  request: Parameters<typeof apiJson>[0],
  token: string,
  opts?: { ymd?: string; minutes?: number; name?: string },
) {
  const placeYmd = opts?.ymd ?? Y.d1;
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

async function readTask(
  request: Parameters<typeof apiJson>[0],
  token: string,
  taskId: string,
) {
  const listed = await apiJson(request, token, 'get', '/tasks');
  return (Array.isArray(listed.body) ? listed.body : []).find(
    (row: { id?: string }) => row.id === taskId,
  );
}

/** Serve one fixed free-slots day (UTC) so the timeline is deterministic. */
async function mockFreeSlots(
  page: Page,
  ymd: string,
  day: {
    start: string;
    end: string;
    busy?: [string, string][];
    free: [string, string][];
    candidates: string[];
  },
) {
  const at = (hm: string) => `${ymd}T${hm}:00.000Z`;
  await page.route('**/schedule/free-slots**', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ymd,
        timeZone: 'UTC',
        durationMinutes: 30,
        dayStart: at(day.start),
        dayEnd: at(day.end),
        phase: null,
        busy: (day.busy ?? []).map(([s, e]) => ({ start: at(s), end: at(e) })),
        free: day.free.map(([s, e]) => ({ start: at(s), end: at(e) })),
        candidates: day.candidates.map(at),
      }),
    });
  });
}

async function openInbox(page: Page, auth: { onboarded: { access_token: string } }, name: string) {
  await openAs(page, auth.onboarded);
  const banner = page.getByRole('region', { name: 'Tasks that fell out of the schedule' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Review' }).click();
  const inbox = page.getByRole('dialog', { name: 'Problematic' });
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText(name)).toBeVisible();
  return inbox;
}

async function openMoveSheet(
  page: Page,
  auth: { onboarded: { access_token: string } },
  name: string,
) {
  const inbox = await openInbox(page, auth, name);
  await inbox.getByRole('button', { name: 'Other time' }).click();
  const move = page.getByRole('dialog', { name: 'Pick a time' });
  await expect(move).toBeVisible();
  return { inbox, move };
}

const timeline = (move: Locator) =>
  move.getByRole('slider', { name: 'Start time on the day timeline' });
const placeButton = (move: Locator) => move.getByRole('button', { name: /^Place( |$)/ });

test.describe('P1 Problematic Move slot pick (U-CAL-025+)', () => {
  test('U-CAL-025a banner Review opens the problematic inbox grouped by day', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token);
    const inbox = await openInbox(page, auth, name);
    await expect(inbox.getByRole('button', { name: 'More actions' }).first()).toBeVisible();
  });

  test('U-CAL-025b Move has a day stepper and a start time, no phase select', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token);
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
    await expect(move.getByRole('button', { name: 'Previous day', exact: true })).toBeVisible();
    await expect(move.getByRole('button', { name: 'Next day', exact: true })).toBeVisible();
    await expect(move.getByRole('button', { name: 'Start time' })).toHaveCount(1);
    await expect(move.getByLabel('Phase')).toHaveCount(0);
  });

  test('U-CAL-025c timeline and suggestions appear; Place is ready', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token);
    const { move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    await expect(move.getByText('Free near the old time')).toBeVisible();
    await expect(placeButton(move)).toBeEnabled({ timeout: 15_000 });
  });

  test('U-CAL-025d Place seats the task and keeps it flexible', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);
    const { name, placeYmd, taskId } = await seedProblematic(request, token, { ymd: Y.d2 });
    const { inbox, move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    await placeButton(move).click();
    await expect(move).toBeHidden({ timeout: 30_000 });
    // The inbox stays open for the next item.
    await expect(inbox).toBeVisible();
    await expect
      .poll(async () => {
        const task = await readTask(request, token, taskId);
        return {
          scheduleState: task?.scheduleState,
          eventType: task?.eventType,
          day: String(task?.scheduledStartTime || '').slice(0, 10),
        };
      })
      .toMatchObject({ scheduleState: 'none', eventType: 'admin', day: placeYmd });
  });

  test('U-CAL-025e Cancel closes the Move sheet without placing', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);
    const { name, taskId } = await seedProblematic(request, token, { ymd: Y.d3 });
    const { move } = await openMoveSheet(page, auth, name);
    await move.getByRole('button', { name: 'Cancel' }).click();
    await expect(move).toBeHidden();
    const task = await readTask(request, token, taskId);
    expect(task?.scheduleState).toBe('problematic');
    expect(task?.eventType).toBe('admin');
  });

  test('U-CAL-025f changing day refetches free-slots', async ({ page, auth, request }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name, placeYmd } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d4,
    });
    const ymds: string[] = [];
    await page.route('**/schedule/free-slots**', async (route) => {
      const url = new URL(route.request().url());
      ymds.push(url.searchParams.get('ymd') || '');
      await route.continue();
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    expect(ymds).toContain(placeYmd);

    await move.getByRole('button', { name: 'Next day', exact: true }).click();
    await expect.poll(() => ymds.includes(Y.d5)).toBe(true);

    await move.getByRole('button', { name: 'Day', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose date' });
    const day = picker.locator(`[data-ymd="${Y.d6}"]`);
    if (!(await day.isVisible())) {
      await picker.getByRole('button', { name: 'Next month' }).click();
    }
    await day.click();
    await expect.poll(() => ymds.includes(Y.d6)).toBe(true);
  });

  test('U-CAL-025g an empty day offers the next day with room', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d6,
    });
    await mockFreeSlots(page, Y.d6, { start: '04:00', end: '19:00', free: [], candidates: [] });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(move.getByText(/No free time long enough on this day/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(move.getByRole('button', { name: 'Next day with room' })).toBeVisible();
    await expect(placeButton(move)).toBeDisabled();
  });

  test('U-CAL-025h free-slots load error surfaces in the sheet', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d7,
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

  test('U-CAL-025i a slot in another phase says the task moves to it', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);
    const phaseName = uniqueName('Move phase');
    const phase = await apiJson(request, token, 'post', '/phases', {
      name: phaseName,
      color: '#2266aa',
      startTime: '10:00',
      endTime: '16:00',
      type: 'time_phase',
    });
    expectOk(phase);
    const { name } = await seedProblematic(request, token, { ymd: Y.d8 });
    await mockFreeSlots(page, Y.d8, {
      start: '08:00',
      end: '18:00',
      free: [['08:00', '18:00']],
      candidates: ['08:00', '11:00'],
    });
    // Registered last, so it sees each request first, then falls back to the mock.
    const phaseIds: string[] = [];
    await page.route('**/schedule/free-slots**', async (route) => {
      phaseIds.push(new URL(route.request().url()).searchParams.get('phaseId') || '');
      await route.fallback();
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    // Full-day fetch: the phase is not an API filter.
    expect(phaseIds.every((id) => id === '')).toBe(true);
    await setStartTime(page, move, '11:00');
    await expect(move.getByTestId('move-phase-change')).toContainText(phaseName);
  });

  test('U-CAL-025j wheel-scrolling the timeline does not snap back to the start', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d9,
    });
    const { move } = await openMoveSheet(page, auth, name);
    const slider = timeline(move);
    await expect(slider).toBeVisible({ timeout: 30_000 });

    const box = await slider.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const scrollTopBefore = await slider.evaluate((el) => el.scrollTop);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(40);
    }

    const scrollTopAfterWheel = await slider.evaluate((el) => el.scrollTop);
    expect(scrollTopAfterWheel - scrollTopBefore).toBeGreaterThan(80);

    await page.waitForTimeout(600);
    const scrollTopLater = await slider.evaluate((el) => el.scrollTop);
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
      ymd: Y.d10,
    });
    await mockFreeSlots(page, Y.d10, {
      start: '06:00',
      end: '18:00',
      busy: [['10:00', '16:00']],
      free: [
        ['06:00', '10:00'],
        ['16:00', '18:00'],
      ],
      candidates: ['06:00', '07:00', '08:00', '09:00', '16:00', '16:30'],
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    await expect(placeButton(move)).toBeEnabled({ timeout: 15_000 });

    // Seek into the busy band: it must not soft-snap back onto a free slot.
    await setStartTime(page, move, '12:00');
    await expect(move.getByText(range('12:00', '12:30')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByText(BUSY_TEXT)).toBeVisible({ timeout: 10_000 });
    await expect(placeButton(move)).toBeDisabled();
  });

  test('U-CAL-025l PgUp/PgDn and End jump between free starts', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d11,
    });
    await mockFreeSlots(page, Y.d11, {
      start: '09:00',
      end: '17:00',
      free: [['09:00', '17:00']],
      candidates: ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00'],
    });
    const { move } = await openMoveSheet(page, auth, name);
    const slider = timeline(move);
    await expect(slider).toBeVisible({ timeout: 30_000 });
    await slider.focus();
    await page.keyboard.press('End');
    await expect(move.getByText(range('15:00', '15:30')).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.keyboard.press('PageUp');
    await expect(move.getByText(range('14:00', '14:30')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(placeButton(move)).toHaveText(/14:00/);
    await expect(move.getByText(BUSY_TEXT)).toHaveCount(0);
  });

  test('U-CAL-025m manual start time seeks and can enable Place', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d12,
    });
    await mockFreeSlots(page, Y.d12, {
      start: '09:00',
      end: '17:00',
      free: [['09:00', '17:00']],
      candidates: ['09:00', '11:00', '14:00', '15:30'],
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    await setStartTime(page, move, '14:00');
    await expect(move.getByText(range('14:00', '14:30')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(placeButton(move)).toBeEnabled();
  });

  test('U-CAL-025n arrow keys move the start by 15 minutes', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d13,
    });
    await mockFreeSlots(page, Y.d13, {
      start: '09:00',
      end: '17:00',
      free: [['09:00', '17:00']],
      candidates: ['09:00', '10:00'],
    });
    const { move } = await openMoveSheet(page, auth, name);
    const slider = timeline(move);
    await expect(slider).toBeVisible({ timeout: 30_000 });
    await expect(move.getByText(range('09:00', '09:30')).first()).toBeVisible();
    await slider.focus();
    await page.keyboard.press('ArrowDown');
    await expect(move.getByText(range('09:15', '09:45')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(placeButton(move)).toBeEnabled();
  });

  test('U-CAL-025o Place toggles with manual time between free and busy', async ({
    page,
    auth,
    request,
  }) => {
    await completeOpenTasks(request, auth.onboarded.access_token);
    const { name } = await seedProblematic(request, auth.onboarded.access_token, {
      ymd: Y.d14,
    });
    await mockFreeSlots(page, Y.d14, {
      start: '09:00',
      end: '17:00',
      busy: [['12:00', '15:00']],
      free: [
        ['09:00', '12:00'],
        ['15:00', '17:00'],
      ],
      candidates: ['09:00', '10:00', '11:00', '15:00', '16:00'],
    });
    const { move } = await openMoveSheet(page, auth, name);
    await expect(timeline(move)).toBeVisible({ timeout: 30_000 });
    const place = placeButton(move);
    await setStartTime(page, move, '10:00');
    await expect(move.getByText(range('10:00', '10:30')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(place).toBeEnabled();
    await expect(move.getByText(BUSY_TEXT)).toHaveCount(0);

    await setStartTime(page, move, '13:00');
    await expect(move.getByText(range('13:00', '13:30')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(move.getByText(BUSY_TEXT)).toBeVisible();
    await expect(place).toBeDisabled();

    await setStartTime(page, move, '15:30');
    await expect(move.getByText(range('15:30', '16:00')).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(place).toBeEnabled();
    await expect(move.getByText(BUSY_TEXT)).toHaveCount(0);
  });

  test('U-CAL-025p the inbox one-tap suggestion seats the task', async ({
    page,
    auth,
    request,
  }) => {
    const token = auth.onboarded.access_token;
    await completeOpenTasks(request, token);
    const { name, placeYmd, taskId } = await seedProblematic(request, token, { ymd: Y.d15 });
    const inbox = await openInbox(page, auth, name);
    const suggestion = inbox.getByRole('button', { name: /^Place at \d{2}:\d{2}$/ });
    await expect(suggestion).toBeVisible({ timeout: 30_000 });
    await suggestion.click();
    await expect
      .poll(async () => {
        const task = await readTask(request, token, taskId);
        return {
          scheduleState: task?.scheduleState,
          day: String(task?.scheduledStartTime || '').slice(0, 10),
        };
      })
      .toMatchObject({ scheduleState: 'none', day: placeYmd });
    await expect(inbox.getByText(name)).toHaveCount(0, { timeout: 15_000 });
  });
});
