import { closeTestApp, createTestApp, E2eApp } from './helpers/create-test-app';
import { createTimePhase, seedOnboardedUser } from './helpers/auth';
import { api, jsonBody } from './helpers/http';
import { seedSlot } from './helpers/slots';
import {
  addDaysToYmd,
  localDateTimeIso,
} from '../src/modules/voice/voice-local-date.util';

/** First Europe/Kyiv civil day whose 09:00 is still in the future (matches hole search). */
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
    const morning = Date.parse(localDateTimeIso(ymd, '09:00', 'Europe/Kyiv'));
    if (morning > now) return ymd;
  }
  throw new Error('no free Kyiv morning in the next 14 days');
}

function kyivWallIso(ymd: string, hm: string): string {
  return localDateTimeIso(ymd, hm, 'Europe/Kyiv');
}

/** API may return Z or offset; compare instants. */
function expectSameInstant(actual: unknown, expectedIso: string): void {
  expect(typeof actual).toBe('string');
  expect(Date.parse(String(actual))).toBe(Date.parse(expectedIso));
}

describe('Schedule API e2e', () => {
  let ctx: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  async function unscheduledFlexible(token: string, name = 'Slot task') {
    const res = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name, estimatedTimeInMinutes: 30, isUnscheduled: true },
    });
    return jsonBody(res);
  }

  it('A-SCH-001 slots have no raw write API (placement writes them)', async () => {
    // PE-30: POST / PATCH / DELETE /schedule wrote slots around the engine. Gone.
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await unscheduledFlexible(token);
    const slot = await seedSlot(
      ctx.app,
      task.id,
      '2026-09-22T10:00:00.000Z',
      '2026-09-22T10:30:00.000Z',
    );
    const payload = {
      taskId: task.id,
      scheduledStartTime: '2026-09-22T11:00:00.000Z',
      scheduledEndTime: '2026-09-22T11:30:00.000Z',
    };
    expect((await api(ctx.app, 'POST', '/schedule', { token, payload })).statusCode).toBe(404);
    expect(
      (await api(ctx.app, 'PATCH', `/schedule/${slot.id}`, { token, payload })).statusCode,
    ).toBe(404);
    expect((await api(ctx.app, 'DELETE', `/schedule/${slot.id}`, { token })).statusCode).toBe(404);
    // The slot is untouched.
    expect((await api(ctx.app, 'GET', `/schedule/${slot.id}`, { token })).statusCode).toBe(200);
  });

  it('A-SCH-005 / A-SCH-007 list and read a slot', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const task = await unscheduledFlexible(token, 'Range');
    const slotId = (
      await seedSlot(ctx.app, task.id, '2026-09-22T13:00:00.000Z', '2026-09-22T13:30:00.000Z')
    ).id;

    const ranged = await api(
      ctx.app,
      'GET',
      '/schedule?startDate=2026-09-22&endDate=2026-09-22',
      { token },
    );
    expect(ranged.statusCode).toBe(200);
    expect(
      (ranged.json() as Array<{ id: string }>).some((row) => row.id === slotId),
    ).toBe(true);

    const one = await api(ctx.app, 'GET', `/schedule/${slotId}`, { token });
    expect(one.statusCode).toBe(200);
  });

  it('A-SCH-035 recurring without preferred: fit / squeeze gaps / pack between fixed / no capacity / fixed mosaic', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day0 = kyivFirstFreeMorningYmd();
    const day1 = addDaysToYmd(day0, 1);
    const day2 = addDaysToYmd(day0, 2);
    const day3 = addDaysToYmd(day0, 3);
    const day4 = addDaysToYmd(day0, 4);
    const at = (ymd: string, hm: string) => kyivWallIso(ymd, hm);

    const postTask = async (payload: Record<string, unknown>) => {
      const res = await api(ctx.app, 'POST', '/tasks', { token, payload });
      expect(res.statusCode).toBe(201);
      await ctx.drainJobs();
      return jsonBody(res) as { id: string };
    };

    /**
     * Four peers (Alpha–Delta) in the 09–11 phase, different layout every day:
     * Series is 45m so gap days must consolidate every 15m fragment (not one slide).
     * day0 — raw hole 09:00–09:45 (peers piled later; no shift)
     * day1 — swiss cheese flexibles: 15m gaps only, free=45 → squeeze peers
     * day2 — fixed wall + gapped flexibles → pack between fixed
     * day3 — solid fill (0 free) → Problematic
     * day4 — fixed mosaic, free=45 as 15×3, nobody movable → Problematic
     */
    type Slot = {
      name: string;
      ymd: string;
      start: string;
      end: string;
      minutes: number;
      fixed?: boolean;
    };
    const landscape: Slot[] = [
      // day0: 09:00–09:45 open
      { name: 'Alpha', ymd: day0, start: '09:45', end: '10:15', minutes: 30 },
      { name: 'Beta', ymd: day0, start: '10:15', end: '10:30', minutes: 15 },
      { name: 'Gamma', ymd: day0, start: '10:30', end: '10:45', minutes: 15 },
      { name: 'Delta', ymd: day0, start: '10:45', end: '11:00', minutes: 15 },

      // day1: swiss cheese — only 15m gaps, free=45 exactly (must squeeze all fragments)
      { name: 'Alpha', ymd: day1, start: '09:00', end: '09:15', minutes: 15 },
      { name: 'Beta', ymd: day1, start: '09:30', end: '10:00', minutes: 30 },
      { name: 'Gamma', ymd: day1, start: '10:15', end: '10:30', minutes: 15 },
      { name: 'Delta', ymd: day1, start: '10:45', end: '11:00', minutes: 15 },

      // day2: fixed wall + gapped flexibles — pack between fixed (free=45)
      { name: 'Alpha', ymd: day2, start: '09:00', end: '09:30', minutes: 30, fixed: true },
      { name: 'Beta', ymd: day2, start: '09:45', end: '10:00', minutes: 15 },
      { name: 'Gamma', ymd: day2, start: '10:15', end: '10:30', minutes: 15 },
      { name: 'Delta', ymd: day2, start: '10:45', end: '11:00', minutes: 15 },

      // day3: solid fill
      { name: 'Alpha', ymd: day3, start: '09:00', end: '09:30', minutes: 30 },
      { name: 'Beta', ymd: day3, start: '09:30', end: '10:00', minutes: 30 },
      { name: 'Gamma', ymd: day3, start: '10:00', end: '10:30', minutes: 30 },
      { name: 'Delta', ymd: day3, start: '10:30', end: '11:00', minutes: 30 },

      // day4: fixed mosaic — free=45 as 15×3, nobody movable
      { name: 'Alpha', ymd: day4, start: '09:00', end: '09:15', minutes: 15, fixed: true },
      { name: 'Beta', ymd: day4, start: '09:30', end: '09:45', minutes: 15, fixed: true },
      { name: 'Gamma', ymd: day4, start: '10:00', end: '10:15', minutes: 15, fixed: true },
      { name: 'Delta', ymd: day4, start: '10:30', end: '11:00', minutes: 30, fixed: true },
    ];

    const peerIds = new Map<string, string>();
    for (const slot of landscape) {
      const row = await postTask({
        name: `${slot.name}-${slot.ymd}`,
        eventType: slot.fixed ? 'fixed' : 'admin',
        estimatedTimeInMinutes: slot.minutes,
        phaseId,
        scheduledStartTime: at(slot.ymd, slot.start),
        scheduledEndTime: at(slot.ymd, slot.end),
      });
      peerIds.set(`${slot.name}-${slot.ymd}`, row.id);
    }

    // NO preferred — first day should take day0 09:00 hole among scattered peers.
    const created = await postTask({
      name: 'series-matrix',
      estimatedTimeInMinutes: 45,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    const tasks = await api(ctx.app, 'GET', '/tasks', { token });
    const taskRows = tasks.json() as Array<{
      id: string;
      name: string;
      scheduleState: string;
      seriesGroupId: string | null;
      parentSeriesId: string | null;
      problematicDay: string | null;
    }>;
    const master = taskRows.find((t) => t.id === created.id)!;
    const groupId = master.seriesGroupId ?? master.id;
    const groupIds = new Set(
      taskRows
        .filter(
          (t) =>
            t.id === master.id ||
            t.seriesGroupId === groupId ||
            t.parentSeriesId === master.id ||
            t.name === 'series-matrix',
        )
        .map((t) => t.id),
    );

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
      scheduledEndTime: string;
    }>;
    const ymdOf = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));

    const groupByDay = new Map<string, string[]>();
    for (const row of rows) {
      if (!groupIds.has(row.taskId)) continue;
      const ymd = ymdOf(row.scheduledStartTime);
      const list = groupByDay.get(ymd) ?? [];
      list.push(row.scheduledStartTime);
      groupByDay.set(ymd, list);
    }

    const slotOnDay = (taskId: string, ymd: string) =>
      rows.find((r) => r.taskId === taskId && ymdOf(r.scheduledStartTime) === ymd);

    const originalStart = (name: string, ymd: string) => {
      const slot = landscape.find((s) => s.name === name && s.ymd === ymd)!;
      return new Date(at(ymd, slot.start)).toISOString();
    };

    const movedPeers = (ymd: string, names: string[]) =>
      names.filter((name) => {
        const id = peerIds.get(`${name}-${ymd}`)!;
        const row = slotOnDay(id, ymd);
        return row != null && row.scheduledStartTime !== originalStart(name, ymd);
      });

    // day0: raw hole at 09:00 — no packing required
    expect(groupByDay.get(day0)).toEqual([
      new Date(at(day0, '09:00')).toISOString(),
    ]);
    expect(movedPeers(day0, ['Alpha', 'Beta', 'Gamma', 'Delta'])).toEqual([]);

    // day1: swiss cheese — must consolidate all 15m gaps into one 45m seat
    expect(groupByDay.get(day1)).toHaveLength(1);
    const day1Series = rows.find(
      (r) => groupIds.has(r.taskId) && ymdOf(r.scheduledStartTime) === day1,
    )!;
    expect(
      (Date.parse(day1Series.scheduledEndTime) - Date.parse(day1Series.scheduledStartTime)) /
        60_000,
    ).toBe(45);
    expect(movedPeers(day1, ['Alpha', 'Beta', 'Gamma', 'Delta']).length).toBeGreaterThanOrEqual(
      3,
    );

    // day2: pack between fixed Alpha wall — flexibles slide; fixed stays
    expect(groupByDay.get(day2)).toHaveLength(1);
    expect(slotOnDay(peerIds.get(`Alpha-${day2}`)!, day2)?.scheduledStartTime).toBe(
      new Date(at(day2, '09:00')).toISOString(),
    );
    expect(movedPeers(day2, ['Beta', 'Gamma', 'Delta']).length).toBeGreaterThanOrEqual(1);

    // day3 / day4: cannot seat — Problematic one-offs
    expect(groupByDay.has(day3)).toBe(false);
    expect(groupByDay.has(day4)).toBe(false);
    const parkedDays = new Set(
      taskRows
        .filter(
          (t) =>
            t.scheduleState === 'problematic' &&
            (t.parentSeriesId === master.id || t.name === 'series-matrix') &&
            t.problematicDay,
        )
        .map((t) => t.problematicDay as string),
    );
    expect(parkedDays.has(day3)).toBe(true);
    expect(parkedDays.has(day4)).toBe(true);
  });

  it('A-SCH-036 recurring unify: pull day0 hole toward majority clock (live 1/2/3/4)', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day0 = kyivFirstFreeMorningYmd();
    const day1 = addDaysToYmd(day0, 1);
    const day2 = addDaysToYmd(day0, 2);
    const at = (ymd: string, hm: string) => kyivWallIso(ymd, hm);

    const postTask = async (payload: Record<string, unknown>) => {
      const res = await api(ctx.app, 'POST', '/tasks', { token, payload });
      expect(res.statusCode).toBe(201);
      await ctx.drainJobs();
      return jsonBody(res) as { id: string };
    };

    /**
     * Independent hole search would seat day0 at 10:30 (solid fill to 10:30)
     * and day1/day2 at 10:00 (gap). Without a unify pass, 10:00 wins as
     * primary and day0 becomes a sibling one-off — the live “4” failure.
     *
     * Also seed three stacked DAILY peers (live 1/2/3) only after the
     * asymmetric landscape is in place via one-offs — the series under test
     * is “4”.
     */
    const landscape: Array<{
      name: string;
      ymd: string;
      start: string;
      end: string;
    }> = [
      { name: 'P1', ymd: day0, start: '09:00', end: '09:30' },
      { name: 'P2', ymd: day0, start: '09:30', end: '10:00' },
      { name: 'P3', ymd: day0, start: '10:00', end: '10:30' },
      { name: 'P1', ymd: day1, start: '09:00', end: '09:30' },
      { name: 'P2', ymd: day1, start: '09:30', end: '10:00' },
      { name: 'P3', ymd: day1, start: '10:30', end: '11:00' },
      { name: 'P1', ymd: day2, start: '09:00', end: '09:30' },
      { name: 'P2', ymd: day2, start: '09:30', end: '10:00' },
      { name: 'P3', ymd: day2, start: '10:30', end: '11:00' },
    ];
    const peerIds = new Map<string, string>();
    for (const slot of landscape) {
      const row = await postTask({
        name: `${slot.name}-${slot.ymd}`,
        estimatedTimeInMinutes: 30,
        phaseId,
        scheduledStartTime: at(slot.ymd, slot.start),
        scheduledEndTime: at(slot.ymd, slot.end),
      });
      peerIds.set(`${slot.name}-${slot.ymd}`, row.id);
    }

    const created = await postTask({
      name: 'series-unify',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    const tasks = await api(ctx.app, 'GET', '/tasks', { token });
    const taskRows = tasks.json() as Array<{
      id: string;
      name: string;
      seriesGroupId: string | null;
      parentSeriesId: string | null;
      skippedOccurrenceYmds: string[] | null;
      isRecurring: boolean;
    }>;
    const master = taskRows.find((t) => t.id === created.id)!;
    const groupId = master.seriesGroupId ?? master.id;
    const groupIds = new Set(
      taskRows
        .filter(
          (t) =>
            t.id === master.id ||
            t.seriesGroupId === groupId ||
            t.parentSeriesId === master.id ||
            t.name === 'series-unify',
        )
        .map((t) => t.id),
    );

    // Must stay one recurring series — not a day0 one-off sibling.
    const siblings = taskRows.filter(
      (t) =>
        t.name === 'series-unify' &&
        t.id !== master.id &&
        (t.seriesGroupId === groupId || t.parentSeriesId === master.id),
    );
    expect(siblings.filter((t) => !t.isRecurring)).toHaveLength(0);

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
    }>;
    const ymdOf = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));
    const hmOf = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso));

    const seriesStarts = rows
      .filter((r) => groupIds.has(r.taskId))
      .map((r) => ({
        ymd: ymdOf(r.scheduledStartTime),
        hm: hmOf(r.scheduledStartTime),
      }));
    const onDay0 = seriesStarts.filter((s) => s.ymd === day0);
    const onDay1 = seriesStarts.filter((s) => s.ymd === day1);
    const onDay2 = seriesStarts.filter((s) => s.ymd === day2);
    expect(onDay0).toHaveLength(1);
    expect(onDay1).toHaveLength(1);
    expect(onDay2).toHaveLength(1);
    expect(onDay0[0].hm).toBe(onDay1[0].hm);
    expect(onDay1[0].hm).toBe(onDay2[0].hm);
    // One series clock for all three days (10:00 via unify or 10:30 trailing pack).
    expect(['10:00', '10:30']).toContain(onDay0[0].hm);
    expect(master.skippedOccurrenceYmds ?? []).not.toContain(day0);
  });

  it('A-SCH-038 recurring does not sit in gap opened by a shifted series peer', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day0 = kyivFirstFreeMorningYmd();
    const day1 = addDaysToYmd(day0, 1);
    const at = (ymd: string, hm: string) => kyivWallIso(ymd, hm);

    const postTask = async (payload: Record<string, unknown>) => {
      const res = await api(ctx.app, 'POST', '/tasks', { token, payload });
      expect(res.statusCode).toBe(201);
      await ctx.drainJobs();
      return jsonBody(res) as { id: string };
    };

    // Series 1 + 3 on day0; on day1 series-3 is a shifted one-off (home 10:00 → 10:15)
    // and series-2 is absent — classic false 09:30 gap (live 15).
    await postTask({
      name: 'peer-1',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: at(day0, '09:00'),
      scheduledEndTime: at(day0, '09:30'),
    });
    const series3 = await postTask({
      name: 'peer-3',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: at(day0, '10:00'),
      scheduledEndTime: at(day0, '10:30'),
    });

    // Detach day1 of series-3 onto 10:15 (shifted one-off with parentSeriesId).
    const skip = await api(ctx.app, 'POST', `/tasks/${series3.id}/skip-occurrence`, {
      token,
      payload: { occurrenceStart: at(day1, '10:00') },
    });
    expect(skip.statusCode).toBe(200);
    await ctx.drainJobs();
    await postTask({
      name: 'peer-3',
      estimatedTimeInMinutes: 30,
      phaseId,
      scheduledStartTime: at(day1, '10:15'),
      scheduledEndTime: at(day1, '10:45'),
      parentSeriesId: series3.id,
      seriesGroupId: series3.id,
    });

    const created = await postTask({
      name: 'series-shifted-gap',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
    }>;
    const ymdOf = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));
    const hmOf = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso));

    const hit = rows.find(
      (r) => r.taskId === created.id && ymdOf(r.scheduledStartTime) === day1,
    );
    expect(hit).toBeTruthy();
    // Must not take the false 09:30 gap; trailing / unify toward 10:00+.
    expect(hmOf(hit!.scheduledStartTime)).not.toBe('09:30');
    expect(
      ['10:00', '10:30', '10:15'].includes(hmOf(hit!.scheduledStartTime)),
    ).toBe(true);
  });

  it('A-SCH-037 recurring after three stacked series peers stays one clock', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day0 = kyivFirstFreeMorningYmd();
    const day1 = addDaysToYmd(day0, 1);
    const day2 = addDaysToYmd(day0, 2);
    const at = (ymd: string, hm: string) => kyivWallIso(ymd, hm);

    const postTask = async (payload: Record<string, unknown>) => {
      const res = await api(ctx.app, 'POST', '/tasks', { token, payload });
      expect(res.statusCode).toBe(201);
      await ctx.drainJobs();
      return jsonBody(res) as { id: string };
    };

    for (const [name, start, end] of [
      ['stack-1', '09:00', '09:30'],
      ['stack-2', '09:30', '10:00'],
      ['stack-3', '10:00', '10:30'],
    ] as const) {
      await postTask({
        name,
        estimatedTimeInMinutes: 30,
        phaseId,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        scheduledStartTime: at(day0, start),
        scheduledEndTime: at(day0, end),
      });
    }

    const created = await postTask({
      name: 'stack-4',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    const tasks = await api(ctx.app, 'GET', '/tasks', { token });
    const taskRows = tasks.json() as Array<{
      id: string;
      name: string;
      seriesGroupId: string | null;
      parentSeriesId: string | null;
      skippedOccurrenceYmds: string[] | null;
      isRecurring: boolean;
    }>;
    const master = taskRows.find((t) => t.id === created.id)!;
    const groupId = master.seriesGroupId ?? master.id;
    const groupIds = new Set(
      taskRows
        .filter(
          (t) =>
            t.id === master.id ||
            t.seriesGroupId === groupId ||
            t.parentSeriesId === master.id ||
            t.name === 'stack-4',
        )
        .map((t) => t.id),
    );
    expect(
      taskRows.filter(
        (t) =>
          t.name === 'stack-4' && t.id !== master.id && !t.isRecurring,
      ),
    ).toHaveLength(0);

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
    }>;
    const ymdOf = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));
    const hmOf = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso));

    const clocks = [day0, day1, day2].map((ymd) => {
      const hit = rows.find(
        (r) => groupIds.has(r.taskId) && ymdOf(r.scheduledStartTime) === ymd,
      );
      expect(hit).toBeTruthy();
      return hmOf(hit!.scheduledStartTime);
    });
    expect(clocks[0]).toBe(clocks[1]);
    expect(clocks[1]).toBe(clocks[2]);
    expect(master.skippedOccurrenceYmds ?? []).not.toContain(day0);
  });

  it('A-SCH-039 recurring create does not shift other series masters on a messy day', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day0 = kyivFirstFreeMorningYmd();
    const at = (ymd: string, hm: string) => kyivWallIso(ymd, hm);

    const postTask = async (payload: Record<string, unknown>) => {
      const res = await api(ctx.app, 'POST', '/tasks', { token, payload });
      expect(res.statusCode).toBe(201);
      await ctx.drainJobs();
      return jsonBody(res) as { id: string };
    };

    const series1 = await postTask({
      name: 'wall-1',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: at(day0, '09:00'),
      scheduledEndTime: at(day0, '09:30'),
    });
    const series2 = await postTask({
      name: 'wall-2',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: at(day0, '09:30'),
      scheduledEndTime: at(day0, '10:00'),
    });
    const series3 = await postTask({
      name: 'wall-3',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: at(day0, '10:00'),
      scheduledEndTime: at(day0, '10:30'),
    });

    // Live day-12 shape: series-1 gone that day; one-off at trailing edge with home 09:00.
    const skip = await api(ctx.app, 'POST', `/tasks/${series1.id}/skip-occurrence`, {
      token,
      payload: { occurrenceStart: at(day0, '09:00') },
    });
    expect(skip.statusCode).toBe(200);
    await ctx.drainJobs();
    await postTask({
      name: 'wall-1',
      estimatedTimeInMinutes: 30,
      phaseId,
      scheduledStartTime: at(day0, '10:30'),
      scheduledEndTime: at(day0, '11:00'),
      parentSeriesId: series1.id,
      seriesGroupId: series1.id,
    });

    const created = await postTask({
      name: 'wall-4',
      estimatedTimeInMinutes: 30,
      phaseId,
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
    }>;
    const ymdOf = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));
    const hmOf = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso));

    const onDay0 = (taskId: string) =>
      rows.find(
        (r) => r.taskId === taskId && ymdOf(r.scheduledStartTime) === day0,
      );

    expect(hmOf(onDay0(series2.id)!.scheduledStartTime)).toBe('09:30');
    expect(hmOf(onDay0(series3.id)!.scheduledStartTime)).toBe('10:00');
    expect(hmOf(onDay0(created.id)!.scheduledStartTime)).toBe('10:30');
  });

  it('A-SCH-034 recurring expand seats a later day on a hole when preferred clock is busy', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day1 = kyivFirstFreeMorningYmd();
    const day2 = addDaysToYmd(day1, 1);
    const at1 = (hm: string) => kyivWallIso(day1, hm);
    const at2 = (hm: string) => kyivWallIso(day2, hm);

    // Fixed blocker on preferred 09:00 day2 — cannot shift; leave 10:00 free.
    const blocker = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'blocker',
        eventType: 'fixed',
        estimatedTimeInMinutes: 30,
        phaseId,
        scheduledStartTime: at2('09:00'),
        scheduledEndTime: at2('09:30'),
      },
    });
    expect(blocker.statusCode).toBe(201);
    await ctx.drainJobs();

    const createdSeries = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'series-clock',
        estimatedTimeInMinutes: 30,
        phaseId,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        scheduledStartTime: at1('09:00'),
        scheduledEndTime: at1('09:30'),
      },
    });
    expect(createdSeries.statusCode).toBe(201);
    const seriesId = String(jsonBody(createdSeries).id);
    await ctx.drainJobs();

    const tasks = await api(ctx.app, 'GET', '/tasks', { token });
    const taskRows = tasks.json() as Array<{
      id: string;
      name: string;
      scheduleState: string;
      seriesGroupId: string | null;
      problematicDay: string | null;
    }>;
    const master = taskRows.find((t) => t.id === seriesId);
    const groupId = master?.seriesGroupId ?? seriesId;
    const groupIds = new Set(
      taskRows
        .filter(
          (t) =>
            t.id === seriesId ||
            t.seriesGroupId === groupId ||
            t.name === 'series-clock',
        )
        .map((t) => t.id),
    );

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
    }>;
    const groupStarts = rows
      .filter((r) => groupIds.has(r.taskId))
      .map((r) => r.scheduledStartTime)
      .sort();
    expect(groupStarts).toEqual(
      expect.arrayContaining([
        new Date(at1('09:00')).toISOString(),
        // Preferred 09:00 blocked by fixed → hole near preferred (09:30).
        new Date(at2('09:30')).toISOString(),
      ]),
    );

    const parked = taskRows.filter(
      (t) =>
        t.name === 'series-clock' &&
        t.scheduleState === 'problematic' &&
        t.problematicDay === day2,
    );
    expect(parked).toHaveLength(0);
  });

  it('A-SCH-033 packs a busy day instead of fleeing to an earlier empty day', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Morning block',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    // Leave the first free morning empty — old logic sat there and never packed.
    const emptyDay = kyivFirstFreeMorningYmd();
    const busyDay = addDaysToYmd(emptyDay, 1);
    const atBusy = (hm: string) => kyivWallIso(busyDay, hm);
    const slots = [
      { name: '1', start: atBusy('09:00'), end: atBusy('09:30') },
      { name: '2', start: atBusy('09:30'), end: atBusy('10:00') },
      { name: '3', start: atBusy('10:15'), end: atBusy('10:45') },
    ];
    for (const row of slots) {
      const created = await api(ctx.app, 'POST', '/tasks', {
        token,
        payload: {
          name: row.name,
          estimatedTimeInMinutes: 30,
          phaseId,
          scheduledStartTime: row.start,
          scheduledEndTime: row.end,
        },
      });
      expect(created.statusCode).toBe(201);
      await ctx.drainJobs();
    }

    const fourth = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: '4',
        estimatedTimeInMinutes: 30,
        phaseId,
      },
    });
    expect(fourth.statusCode).toBe(201);
    const fourthId = String(jsonBody(fourth).id);
    await ctx.drainJobs();

    const schedule = await api(ctx.app, 'GET', '/schedule', { token });
    expect(schedule.statusCode).toBe(200);
    const rows = schedule.json() as Array<{
      taskId: string;
      scheduledStartTime: string;
      scheduledEndTime: string;
    }>;
    const tasksList = await api(ctx.app, 'GET', '/tasks', { token });
    const taskNameById = new Map(
      (tasksList.json() as Array<{ id: string; name: string; scheduleState: string }>).map(
        (t) => [t.id, t] as const,
      ),
    );
    const byName = new Map<string, { start: string; end: string }>();
    for (const row of rows) {
      const task = taskNameById.get(row.taskId);
      if (!task) continue;
      byName.set(task.name, {
        start: row.scheduledStartTime,
        end: row.scheduledEndTime,
      });
    }

    // Must not take the empty earlier morning.
    expect(byName.get('4')?.start).not.toBe(
      new Date(kyivWallIso(emptyDay, '09:00')).toISOString(),
    );
    expect(
      Object.fromEntries(
        [...byName.entries()].map(([name, slot]) => [name, slot.start]),
      ),
    ).toEqual({
      '1': new Date(atBusy('09:00')).toISOString(),
      '2': new Date(atBusy('09:30')).toISOString(),
      '3': new Date(atBusy('10:00')).toISOString(),
      '4': new Date(atBusy('10:30')).toISOString(),
    });
    expect(byName.get('3')?.end).toBe(new Date(atBusy('10:30')).toISOString());
    expect(byName.get('4')?.end).toBe(new Date(atBusy('11:00')).toISOString());

    const fourthTask = await api(ctx.app, 'GET', `/tasks/${fourthId}`, {
      token,
    });
    expect((fourthTask.json() as { scheduleState: string }).scheduleState).not.toBe(
      'problematic',
    );

    const opens = ['1', '2', '3', '4'].map((name) => byName.get(name)!);
    for (let i = 0; i < opens.length; i += 1) {
      for (let j = i + 1; j < opens.length; j += 1) {
        const a0 = Date.parse(opens[i].start);
        const a1 = Date.parse(opens[i].end);
        const b0 = Date.parse(opens[j].start);
        const b1 = Date.parse(opens[j].end);
        expect(a0 < b1 && b0 < a1).toBe(false);
      }
    }
  });

  it('A-SCH-009 create seats a flexible task; generate/preview are gone', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: { name: 'Seat me', estimatedTimeInMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);
    const taskId = String(jsonBody(created).id);
    await ctx.drainJobs();

    const seated = await api(ctx.app, 'GET', '/schedule', { token });
    expect(seated.statusCode).toBe(200);
    const seatedRows = seated.json() as Array<{ taskId: string }>;
    expect(seatedRows.some((row) => row.taskId === taskId)).toBe(true);

    expect(
      (await api(ctx.app, 'POST', '/schedule/generate', { token, payload: {} }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'POST', '/schedule/preview', { token, payload: {} }))
        .statusCode,
    ).toBe(404);
  });

  it('A-SCH-040 create preferred on fixed → job conflicts → leave_problematic / move_new / place_on_top (CD04/CD08)', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Conflict morning',
      startTime: '09:00',
      endTime: '12:00',
    });
    const phaseId = String(phase.id);
    const day = kyivFirstFreeMorningYmd();
    const at = (hm: string) => kyivWallIso(day, hm);

    const fixed = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Anchor fixed',
        eventType: 'fixed',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
      },
    });
    expect(fixed.statusCode).toBe(201);
    await ctx.drainJobs();
    const fixedId = String(jsonBody(fixed).id);

    const created = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Claim preferred',
        eventType: 'admin',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
        timeZone: 'Europe/Kyiv',
      },
    });
    expect(created.statusCode).toBe(201);
    const claim = jsonBody(created) as { id: string; jobId: string };
    expect(claim.jobId).toBeTruthy();
    await ctx.drainJobs();

    const job = await api(ctx.app, 'GET', `/schedule-jobs/${claim.jobId}`, {
      token,
    });
    expect(job.statusCode).toBe(200);
    const jobBody = jsonBody(job) as {
      status: string;
      result?: { conflicts?: Array<{ reason: string; options: string[]; taskId: string }> };
    };
    expect(jobBody.status).toBe('done');
    expect(jobBody.result?.conflicts?.length).toBe(1);
    const conflict = jobBody.result!.conflicts![0];
    expect(conflict.reason).toBe('preferred_on_fixed');
    expect(conflict.taskId).toBe(claim.id);
    expect(conflict.options).toEqual(
      expect.arrayContaining([
        'place_on_top',
        'move_new',
        'leave_problematic',
      ]),
    );
    expect(conflict.options).not.toContain('move_other');

    const fixedAfter = await api(ctx.app, 'GET', `/tasks/${fixedId}`, { token });
    expectSameInstant(jsonBody(fixedAfter).scheduledStartTime, at('09:00'));

    // leave_problematic parks the claimant.
    const parked = await api(ctx.app, 'PATCH', `/tasks/${claim.id}`, {
      token,
      payload: {
        scheduleState: 'problematic',
        problematicReason: 'preferred_on_fixed',
        problematicOccurrenceYmds: [day],
        problematicOriginalStart: at('09:00'),
        problematicOriginalEnd: at('10:00'),
      },
    });
    expect(parked.statusCode).toBe(200);
    await ctx.drainJobs();
    expect(jsonBody(parked).scheduleState).toBe('problematic');

    // Fresh claim for move_new: seat elsewhere (clear preferred clock).
    const created2 = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Claim move_new',
        eventType: 'admin',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
        timeZone: 'Europe/Kyiv',
      },
    });
    expect(created2.statusCode).toBe(201);
    const claim2 = jsonBody(created2) as { id: string; jobId: string };
    await ctx.drainJobs();
    const job2 = await api(ctx.app, 'GET', `/schedule-jobs/${claim2.jobId}`, {
      token,
    });
    expect(
      (jsonBody(job2) as { result?: { conflicts?: unknown[] } }).result?.conflicts
        ?.length,
    ).toBe(1);

    const moved = await api(ctx.app, 'PATCH', `/tasks/${claim2.id}`, {
      token,
      payload: {
        scheduleState: 'none',
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
    });
    expect(moved.statusCode).toBe(200);
    await ctx.drainJobs();
    const movedRow = jsonBody(
      await api(ctx.app, 'GET', `/tasks/${claim2.id}`, { token }),
    ) as { scheduleState: string; scheduledStartTime: string | null };
    expect(movedRow.scheduleState).not.toBe('problematic');
    expect(movedRow.scheduledStartTime).toBeTruthy();
    expect(Date.parse(String(movedRow.scheduledStartTime))).not.toBe(
      Date.parse(at('09:00')),
    );

    // place_on_top → resolved on preferred.
    const created3 = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Claim on top',
        eventType: 'admin',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
        timeZone: 'Europe/Kyiv',
      },
    });
    expect(created3.statusCode).toBe(201);
    const claim3 = jsonBody(created3) as { id: string; jobId: string };
    await ctx.drainJobs();

    const onTop = await api(ctx.app, 'PATCH', `/tasks/${claim3.id}`, {
      token,
      payload: {
        scheduleState: 'resolved',
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
        problematicOriginalStart: at('09:00'),
        problematicOriginalEnd: at('10:00'),
        problematicReason: 'preferred_on_fixed',
      },
    });
    expect(onTop.statusCode).toBe(200);
    await ctx.drainJobs();
    expect(jsonBody(onTop).scheduleState).toBe('resolved');
    expectSameInstant(jsonBody(onTop).scheduledStartTime, at('09:00'));

    const fixedFinal = await api(ctx.app, 'GET', `/tasks/${fixedId}`, { token });
    expectSameInstant(jsonBody(fixedFinal).scheduledStartTime, at('09:00'));
  });

  it('A-SCH-041 fixed vs fixed overlap returns conflict on job (CD07 / T15)', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Fixed clash',
      startTime: '09:00',
      endTime: '12:00',
    });
    const phaseId = String(phase.id);
    const day = kyivFirstFreeMorningYmd();
    const at = (hm: string) => kyivWallIso(day, hm);

    const f1 = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Fixed A',
        eventType: 'fixed',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
      },
    });
    expect(f1.statusCode).toBe(201);
    await ctx.drainJobs();

    const f2 = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Fixed B',
        eventType: 'fixed',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:30'),
        scheduledEndTime: at('10:30'),
      },
    });
    expect(f2.statusCode).toBe(201);
    const body = jsonBody(f2) as { id: string; jobId: string };
    await ctx.drainJobs();

    const job = await api(ctx.app, 'GET', `/schedule-jobs/${body.jobId}`, {
      token,
    });
    const result = jsonBody(job).result as {
      conflicts?: Array<{ reason: string }>;
    };
    expect(result?.conflicts?.length).toBe(1);
    expect(result.conflicts![0].reason).toBe('preferred_on_fixed');

    const a = jsonBody(
      await api(ctx.app, 'GET', `/tasks/${jsonBody(f1).id}`, { token }),
    );
    expectSameInstant(a.scheduledStartTime, at('09:00'));
  });

  it('A-SCH-042 free hole create seats silently on the busy day (CD01)', async () => {
    const { token } = await seedOnboardedUser(ctx.app);
    const phase = await createTimePhase(ctx.app, token, {
      name: 'Pack day',
      startTime: '09:00',
      endTime: '11:00',
    });
    const phaseId = String(phase.id);
    const day = kyivFirstFreeMorningYmd();
    const at = (hm: string) => kyivWallIso(day, hm);

    await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Peer morning',
        eventType: 'admin',
        estimatedTimeInMinutes: 60,
        phaseId,
        scheduledStartTime: at('09:00'),
        scheduledEndTime: at('10:00'),
      },
    });
    await ctx.drainJobs();

    const hole = await api(ctx.app, 'POST', '/tasks', {
      token,
      payload: {
        name: 'Takes hole',
        eventType: 'admin',
        estimatedTimeInMinutes: 60,
        phaseId,
      },
    });
    expect(hole.statusCode).toBe(201);
    const holeTask = jsonBody(hole) as { id: string; jobId: string };
    await ctx.drainJobs();
    const seated = jsonBody(
      await api(ctx.app, 'GET', `/tasks/${holeTask.id}`, { token }),
    ) as { scheduleState: string; scheduledStartTime: string | null };
    expect(seated.scheduleState).toBe('none');
    expectSameInstant(seated.scheduledStartTime, at('10:00'));

    const job = await api(ctx.app, 'GET', `/schedule-jobs/${holeTask.jobId}`, {
      token,
    });
    expect(
      (jsonBody(job) as { result?: { conflicts?: unknown[] } }).result?.conflicts
        ?? [],
    ).toEqual([]);
    // Solid-fill → Problematic across the horizon: A-SCH-035 day3/day4.
  });
});
