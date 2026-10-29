/**
 * Regression tests for documentation/placement-engine-review.md (roadmap §50).
 * `it.failing` marks a known defect: flip it to `it` in the diff that fixes it.
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, TaskStatus } from '../tasks/entities/task.entity';
import { DisplayedEventMoveService } from './displayed-event-move.service';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';
import {
  planPlacement,
  seriesHorizonYmds,
  type PlacementSeat,
} from './placement-step.util';

const DAY = Date.parse('2026-10-08T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const WINDOW = [{ start: DAY, end: DAY + 8 * HOUR }];

function seat(
  partial: Partial<PlacementSeat> & Pick<PlacementSeat, 'id' | 'role' | 'start' | 'end'>,
): PlacementSeat {
  return {
    taskId: partial.taskId ?? partial.id,
    taskName: partial.taskName ?? partial.id,
    windows: partial.windows ?? WINDOW,
    notBefore: partial.notBefore ?? DAY,
    ...partial,
  };
}

function fixedClaim(start: number, recurring = false) {
  return {
    taskId: 'fixed',
    taskName: 'Fixed',
    recurring,
    durationMinutes: 60,
    notBefore: DAY,
    windows: WINDOW,
    interval: { start, end: start + HOUR },
    mustFitWindow: false,
  };
}

describe('placement engine review regressions', () => {
  it('PE-23 a displaced flexible takes the hole nearest its old time', () => {
    // Window 09:00–17:00; claim takes 15:00 where the flexible sat.
    const plan = planPlacement({
      claim: fixedClaim(DAY + 6 * HOUR),
      seats: [seat({ id: 'flex', role: 'flexible', start: DAY + 6 * HOUR, end: DAY + 7 * HOUR })],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      moves: [{ kind: 'shift', seatId: 'flex', start: DAY + 5 * HOUR }],
    });
  });

  it('PE-11 a raw-hole search parks instead of packing seated peers', () => {
    // 08:00–16:00 window; flexibles 08–09:30, 10–12, 12:30–16. No free hour.
    const seats = [
      seat({ id: 'a', role: 'flexible', start: DAY - HOUR, end: DAY + HOUR / 2 }),
      seat({ id: 'b', role: 'flexible', start: DAY + HOUR, end: DAY + 3 * HOUR }),
      seat({ id: 'c', role: 'flexible', start: DAY + 3.5 * HOUR, end: DAY + 8 * HOUR }),
    ];
    const base = {
      taskId: 'parked',
      taskName: 'Parked',
      recurring: false,
      durationMinutes: 60,
      notBefore: DAY - HOUR,
      windows: [{ start: DAY - HOUR, end: DAY + 8 * HOUR }],
      interval: null,
    };
    expect(planPlacement({ claim: base, seats })).toMatchObject({ outcome: 'seated' });
    expect(planPlacement({ claim: { ...base, allowPack: false }, seats })).toEqual({
      outcome: 'problematic',
      reason: 'no_slot',
    });
  });

  it('PE-03 a fixed claim sits on top of a resolved layer and nobody moves', () => {
    const plan = planPlacement({
      claim: fixedClaim(DAY + HOUR),
      seats: [
        seat({ id: 'kept', role: 'resolved', start: DAY + HOUR, end: DAY + 2 * HOUR }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY + HOUR,
      end: DAY + 2 * HOUR,
      moves: [],
    });
  });

  it('PE-04 a fixed series day over another series keeps its clock', () => {
    const plan = planPlacement({
      claim: fixedClaim(DAY + HOUR, true),
      seats: [
        seat({ id: 'other', role: 'series', start: DAY + HOUR, end: DAY + 2 * HOUR }),
      ],
    });
    // Seated on its own clock (the other day is displaced) or a conflict — never elsewhere.
    if (plan.outcome === 'seated') {
      expect(plan.start).toBe(DAY + HOUR);
    } else {
      expect(plan.outcome).toBe('conflict');
    }
  });

  it('PE-08 BIWEEKLY Mon/Fri counts weeks from the week start (WKST=MO)', () => {
    // Anchor Fri 30 Oct: on weeks are 26 Oct, 9 Nov, 23 Nov.
    expect(
      seriesHorizonYmds({
        anchorYmd: '2026-10-30',
        horizonEndYmd: '2026-11-28',
        pattern: 'BIWEEKLY',
        weekDays: [1, 5],
      }),
    ).toEqual(['2026-10-30', '2026-11-09', '2026-11-13', '2026-11-23', '2026-11-27']);
  });

  it('PE-09 MONTHLY from the 31st steps from the anchor and clamps to the month end', () => {
    expect(
      seriesHorizonYmds({
        anchorYmd: '2027-01-31',
        horizonEndYmd: '2027-06-01',
        pattern: 'MONTHLY',
      }),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });
});

describe('placement engine review regressions (SQLite)', () => {
  let kit: PlacementKit;

  afterEach(async () => {
    await kit?.destroy();
  });

  it('kit: a one-off with no clock takes the first free hour and writes one slot', async () => {
    // Thu 5 Nov 2026, 08:00 UTC; wake 08:00.
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const task = await kit.addTask({ name: 'One-off' });

    const plan = await kit.service.place(kit.user.id, task.id);

    expect(plan.outcome).toBe('seated');
    expect(await kit.slotsOf(task.id)).toEqual(['2026-11-05 08:00-09:00']);
  });

  it('PE-10 re-seating a weekly series keeps its weekday, not today', async () => {
    // Monday weekly series, clock edited on Thursday 5 Nov.
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const task = await kit.addTask({
      name: 'Weekly',
      isRecurring: true,
      recurrencePattern: 'WEEKLY',
      earliestStartTime: kit.at('2026-11-02', '00:00'),
      scheduledStartTime: kit.at('2026-11-02', '10:00'),
      scheduledEndTime: kit.at('2026-11-02', '11:00'),
    });
    await kit.addSlot(task.id, kit.at('2026-11-09', '10:00'), kit.at('2026-11-09', '11:00'));

    await kit.service.place(kit.user.id, task.id, {
      preferredStart: kit.at('2026-11-09', '11:00'),
      expandSeries: true,
    });

    expect(await kit.slotsOf(task.id)).toEqual([
      '2026-11-09 11:00-12:00',
      '2026-11-16 11:00-12:00',
    ]);
  });

  it('PE-05 re-merge does not absorb a copy dropped on another day', async () => {
    // Monday weekly series; the 9 Nov day was detached into a copy at 14:00.
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const group = '11111111-1111-4111-8111-111111111111';
    const series = await kit.addTask({
      name: 'Weekly',
      isRecurring: true,
      recurrencePattern: 'WEEKLY',
      seriesGroupId: group,
      skippedOccurrenceYmds: ['2026-11-09'],
      earliestStartTime: kit.at('2026-11-02', '00:00'),
      scheduledStartTime: kit.at('2026-11-16', '10:00'),
      scheduledEndTime: kit.at('2026-11-16', '11:00'),
    });
    await kit.addSlot(series.id, kit.at('2026-11-16', '10:00'), kit.at('2026-11-16', '11:00'));
    const copy = await kit.addTask({
      name: 'Weekly',
      seriesGroupId: group,
      parentSeriesId: series.id,
      scheduledStartTime: kit.at('2026-11-09', '14:00'),
      scheduledEndTime: kit.at('2026-11-09', '15:00'),
    });
    await kit.addSlot(copy.id, kit.at('2026-11-09', '14:00'), kit.at('2026-11-09', '15:00'));

    // Drag the copy to Wednesday at the series clock.
    await kit.service.place(kit.user.id, copy.id, {
      preferredStart: kit.at('2026-11-11', '10:00'),
      drag: true,
    });

    expect(await kit.slotsOf(copy.id)).toEqual(['2026-11-11 10:00-11:00']);
    expect(await kit.slotsOf(series.id)).toEqual(['2026-11-16 10:00-11:00']);
    expect((await kit.reload(series.id)).skippedOccurrenceYmds).toContain('2026-11-09');
  });

  it('PE-07 shifting one series day does not change the clock of new days', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      earliestStartTime: kit.at('2026-11-06', '00:00'),
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });
    await kit.addSlot(series.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    await kit.addSlot(series.id, kit.at('2026-11-07', '10:00'), kit.at('2026-11-07', '11:00'));
    const fixed = await kit.addTask({
      name: 'Fixed',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });

    await kit.service.place(kit.user.id, fixed.id, {
      preferredStart: kit.at('2026-11-06', '10:00'),
    });
    await kit.service.appendMissingSeriesDays(kit.user.id);

    const days = await kit.slotsOf(series.id);
    expect(days.filter((row) => row >= '2026-11-08')).not.toHaveLength(0);
    expect(days.filter((row) => row >= '2026-11-08' && !row.endsWith('10:00-11:00'))).toEqual([]);
  });

  it('PE-02 dragging "this and following" leaves one slot per day before the split', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z', horizonDays: 7 });
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduleTimeZone: 'UTC',
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    for (const ymd of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']) {
      await kit.addSlot(series.id, kit.at(ymd, '10:00'), kit.at(ymd, '11:00'));
    }
    const move = new DisplayedEventMoveService(
      kit.slotRepo,
      kit.taskRepo,
      {} as never,
      {} as never,
      {} as never,
      kit.pendingGoogleWrites as never,
      kit.service,
      { getSettings: async () => kit.settings } as never,
      { findAllForScheduling: async () => [] } as never,
      {} as never,
    );

    // Drag the 8 Nov day to 15:00, scope "this and following".
    await move['moveSeriesTail'](
      kit.user.id,
      series,
      {
        originalStart: kit.at('2026-11-08', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-08', '11:00').toISOString(),
        start: kit.at('2026-11-08', '15:00').toISOString(),
        end: kit.at('2026-11-08', '16:00').toISOString(),
      } as never,
      kit.at('2026-11-08', '15:00'),
      kit.at('2026-11-08', '16:00'),
      60,
      [],
    );

    const rows = await kit.slotRepo.find();
    const perDay = new Map<string, number>();
    for (const row of rows) {
      const ymd = kit.ymdOf(row.scheduledStartTime);
      perDay.set(ymd, (perDay.get(ymd) ?? 0) + 1);
    }
    expect(Object.fromEntries(perDay)).toEqual({
      '2026-11-05': 1,
      '2026-11-06': 1,
      '2026-11-07': 1,
      '2026-11-08': 1,
      '2026-11-09': 1,
      '2026-11-10': 1,
      '2026-11-11': 1,
    });
    expect(await kit.slotsOf(series.id)).toEqual([
      '2026-11-05 10:00-11:00',
      '2026-11-06 10:00-11:00',
      '2026-11-07 10:00-11:00',
    ]);
  });

  it('PE-01 a new series clock keeps the master and its open days on one clock', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z', horizonDays: 4 });
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    for (const ymd of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) {
      await kit.addSlot(series.id, kit.at(ymd, '10:00'), kit.at(ymd, '11:00'));
    }

    // The form still carries an earlier date with the new 11:00 clock.
    await kit.tasksService.update(series.id, kit.user.id, {
      scheduledStartTime: kit.at('2026-11-04', '11:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-04', '12:00').toISOString(),
    } as never);
    await kit.jobs.settle();

    const master = await kit.reload(series.id);
    const days = await kit.slotsOf(series.id);
    expect(days.length).toBeGreaterThan(0);
    expect(days.map((row) => row.slice(11, 16))).toEqual(
      days.map(() => kit.hmOf(master.scheduledStartTime!)),
    );
  });

  it('PE-06 a fixed drag onto another fixed keeps the task clock equal to its slot', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const first = await kit.addTask({
      name: 'First',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });
    await kit.addSlot(first.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    const second = await kit.addTask({
      name: 'Second',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-06', '14:00'),
      scheduledEndTime: kit.at('2026-11-06', '15:00'),
    });
    await kit.addSlot(second.id, kit.at('2026-11-06', '14:00'), kit.at('2026-11-06', '15:00'));

    await kit.tasksService.update(second.id, kit.user.id, {
      scheduledStartTime: kit.at('2026-11-06', '10:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-06', '11:00').toISOString(),
    } as never);
    await kit.jobs.settle();

    const task = await kit.reload(second.id);
    const slots = await kit.slotsOf(second.id);
    expect(slots).toEqual([
      `2026-11-06 ${kit.hmOf(task.scheduledStartTime!)}-${kit.hmOf(task.scheduledEndTime!)}`,
    ]);
  });

  it('PE-17 a new daily series at 14:00 with no clock still seats today', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T14:00:00.000Z', horizonDays: 2 });
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    await kit.service.place(kit.user.id, series.id, { expandSeries: true, searchHole: true });

    // Today keeps its own hole after now (a clock sibling when the series
    // clock is the earlier one tomorrow); no day is lost or seated in the past.
    const rows = (await kit.slotRepo.find()).map(
      (row) => `${kit.ymdOf(row.scheduledStartTime)} ${kit.hmOf(row.scheduledStartTime)}`,
    );
    expect(rows.sort()).toEqual(['2026-11-05 14:00', '2026-11-06 08:00']);
  });

  async function fixedAt(ymd: string, from: string, to: string, name = 'Fixed') {
    const task = await kit.addTask({
      name,
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at(ymd, from),
      scheduledEndTime: kit.at(ymd, to),
    });
    await kit.addSlot(task.id, kit.at(ymd, from), kit.at(ymd, to));
    return task;
  }

  it('PE-12 a canceled task frees its time and is never moved', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const canceled = await kit.addTask({
      name: 'Canceled',
      status: TaskStatus.CANCELED,
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });
    await kit.addSlot(canceled.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    const fixed = await fixedAt('2026-11-06', '10:00', '11:00');

    await kit.service.place(kit.user.id, fixed.id, {
      preferredStart: kit.at('2026-11-06', '10:00'),
    });

    expect(await kit.slotsOf(canceled.id)).toEqual(['2026-11-06 10:00-11:00']);
    expect((await kit.reload(canceled.id)).scheduleState).toBe(ScheduleState.NONE);
  });

  it('PE-13 a displaced task never moves before its own From', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const peer = await kit.addTask({
      name: 'Peer',
      earliestStartTime: kit.at('2026-11-06', '10:00'),
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });
    await kit.addSlot(peer.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    await fixedAt('2026-11-06', '12:00', '13:00', 'Wall');
    const fixed = await fixedAt('2026-11-06', '10:00', '12:00');

    await kit.service.place(kit.user.id, fixed.id, {
      preferredStart: kit.at('2026-11-06', '10:00'),
    });

    // 09:00 is nearer but before its From; 13:00 is the first legal hole.
    expect(await kit.slotsOf(peer.id)).toEqual(['2026-11-06 13:00-14:00']);
  });

  it('PE-15 an unphased peer searches wake/sleep, not the union of all phases', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    await kit.addPhase({ name: 'Morning', startTime: '08:00', endTime: '10:00' });
    await fixedAt('2026-11-06', '08:00', '10:00', 'Wall');
    const peer = await kit.addTask({
      name: 'Peer',
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });
    await kit.addSlot(peer.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    const fixed = await fixedAt('2026-11-06', '10:00', '11:00');

    await kit.service.place(kit.user.id, fixed.id, {
      preferredStart: kit.at('2026-11-06', '10:00'),
    });

    expect(await kit.slotsOf(peer.id)).toEqual(['2026-11-06 11:00-12:00']);
    expect((await kit.reload(peer.id)).scheduleState).toBe(ScheduleState.NONE);
  });

  it('PE-19 a series with no free day parks one copy per day, not the master too', async () => {
    kit = await createPlacementKit({
      now: '2026-11-05T07:00:00.000Z',
      wakeTime: '08:00',
      sleepTime: '09:00',
      horizonDays: 2,
    });
    await fixedAt('2026-11-05', '08:00', '09:00', 'Wall 1');
    await fixedAt('2026-11-06', '08:00', '09:00', 'Wall 2');
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
    });

    await kit.service.place(kit.user.id, series.id, { expandSeries: true, searchHole: true });

    const parked = await kit.taskRepo.find({ where: { scheduleState: ScheduleState.PROBLEMATIC } });
    expect(parked.map((task) => task.problematicDay).sort()).toEqual([
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(parked.every((task) => task.parentSeriesId === series.id)).toBe(true);
    expect((await kit.reload(series.id)).scheduleState).toBe(ScheduleState.NONE);
  });

  it('PE-18 a failure part-way through a series rewrite leaves nothing half-written', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z', horizonDays: 2 });
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    await kit.addSlot(series.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
    await kit.addSlot(series.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    const peer = await kit.addTask({
      name: 'Peer',
      scheduledStartTime: kit.at('2026-11-05', '11:00'),
      scheduledEndTime: kit.at('2026-11-05', '12:00'),
    });
    await kit.addSlot(peer.id, kit.at('2026-11-05', '11:00'), kit.at('2026-11-05', '12:00'));

    // Peer moves are written first; then the old series rows go and the write dies.
    const service = kit.service as unknown as {
      deleteOpenSlots: (...args: unknown[]) => Promise<void>;
    };
    const realDelete = service.deleteOpenSlots.bind(kit.service);
    jest.spyOn(service, 'deleteOpenSlots').mockImplementation(async (...args) => {
      await realDelete(...args);
      throw new Error('disk full');
    });

    await expect(
      kit.service.place(kit.user.id, series.id, {
        preferredStart: kit.at('2026-11-05', '11:00'),
        expandSeries: true,
      }),
    ).rejects.toThrow('disk full');

    expect(await kit.slotsOf(peer.id)).toEqual(['2026-11-05 11:00-12:00']);
    expect(await kit.slotsOf(series.id)).toEqual([
      '2026-11-05 10:00-11:00',
      '2026-11-06 10:00-11:00',
    ]);
    expect(kit.pendingGoogleWrites.syncTaskSoon).not.toHaveBeenCalled();
  });

  it('PE-29 purge reaches a past copy behind many future parks', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    for (let i = 0; i < 10; i += 1) {
      await kit.addTask({
        name: `Future ${i}`,
        scheduleState: ScheduleState.PROBLEMATIC,
        problematicDay: '2026-11-20',
      });
    }
    const past = await kit.addTask({
      name: 'Past copy',
      scheduleState: ScheduleState.PROBLEMATIC,
      problematicDay: '2026-11-03',
    });

    expect(await kit.service.purgePastProblematicCopies(1)).toBe(1);
    expect(await kit.taskRepo.findOneBy({ id: past.id })).toBeNull();
  });

  it('PE-26 a task back to todo keeps a free slot and moves off a taken one', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const done = await kit.addTask({
      name: 'Done',
      status: TaskStatus.COMPLETED,
      scheduledStartTime: kit.at('2026-11-06', '10:00'),
      scheduledEndTime: kit.at('2026-11-06', '11:00'),
    });
    await kit.addSlot(done.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    const free = await kit.addTask({
      name: 'Free',
      status: TaskStatus.CANCELED,
      scheduledStartTime: kit.at('2026-11-06', '14:00'),
      scheduledEndTime: kit.at('2026-11-06', '15:00'),
    });
    await kit.addSlot(free.id, kit.at('2026-11-06', '14:00'), kit.at('2026-11-06', '15:00'));
    // Took the done task's hour while it was done.
    await fixedAt('2026-11-06', '10:00', '11:00', 'Newcomer');

    await kit.tasksService.updateStatus(done.id, kit.user.id, TaskStatus.TODO);
    await kit.tasksService.updateStatus(free.id, kit.user.id, TaskStatus.TODO);

    expect(await kit.slotsOf(done.id)).not.toContain('2026-11-06 10:00-11:00');
    expect(await kit.slotsOf(done.id)).toHaveLength(1);
    expect(await kit.slotsOf(free.id)).toEqual(['2026-11-06 14:00-15:00']);
  });
});
