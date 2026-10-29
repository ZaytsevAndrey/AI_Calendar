/**
 * Placement edge cases through the real services on SQLite: chain depth,
 * cross-midnight, very long tasks, full windows, repeated placement,
 * preferred-time conflicts, horizon boundary, a series edit while its
 * placement is still queued, and a DST gap. Each test checks the engine
 * invariants: no overlap, fixed anchors stay, every task seated or parked.
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, Task } from '../tasks/entities/task.entity';
import { ScheduleJob } from './entities/schedule-job.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('placement edge cases', () => {
  let kit: PlacementKit;

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit?.destroy();
    kit = undefined as unknown as PlacementKit;
  });

  const create = async (body: Record<string, unknown>) => {
    const created = await kit.tasksService.create(kit.user.id, {
      timeZone: kit.settings.timeZone,
      priority: 'medium',
      allowSplit: false,
      ...body,
    } as never);
    await kit.jobs.settle();
    return created as Task & { jobId: string };
  };
  const fixed = (name: string, ymd: string, from: string, to: string) =>
    create({
      name,
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at(ymd, from).toISOString(),
      scheduledEndTime: kit.at(ymd, to).toISOString(),
    });
  /** Conflicts the create job reported (the conflict sheet the SPA shows). */
  const jobConflicts = async (jobId: string) => {
    const job = await kit.ds.getRepository(ScheduleJob).findOneByOrFail({ id: jobId });
    return (JSON.parse(job.resultDiffJson ?? '{}') as { conflicts?: unknown[] }).conflicts ?? [];
  };
  const flexible = (name: string, minutes: number, extra: Record<string, unknown> = {}) =>
    create({ name, estimatedTimeInMinutes: minutes, ...extra });

  /**
   * Engine invariants over every slot of the user. `awaitingChoice`: tasks whose
   * job returned a conflict sheet wait unseated for the user (by design).
   */
  async function expectInvariants(awaitingChoice: string[] = []) {
    const tasks = await kit.taskRepo.find({ where: { userId: kit.user.id } });
    const slots = await kit.slotRepo.find();
    const spans = slots
      .map((row) => ({
        taskId: row.taskId,
        start: new Date(row.scheduledStartTime).getTime(),
        end: new Date(row.scheduledEndTime).getTime(),
      }))
      .sort((a, b) => a.start - b.start);
    const fixedIds = new Set(tasks.filter((t) => t.eventType === TaskEventType.FIXED).map((t) => t.id));
    for (let i = 1; i < spans.length; i += 1) {
      // Only an explicit fixed-on-fixed may overlap; flexible work never does.
      const overlap = spans[i].start < spans[i - 1].end;
      if (overlap) expect(fixedIds.has(spans[i].taskId) && fixedIds.has(spans[i - 1].taskId)).toBe(true);
    }
    for (const task of tasks) {
      const seated = spans.some((span) => span.taskId === task.id);
      const parked =
        task.scheduleState === ScheduleState.PROBLEMATIC || task.isUnscheduled || awaitingChoice.includes(task.id);
      expect({ name: task.name, placedOrParked: seated || parked }).toEqual({ name: task.name, placedOrParked: true });
    }
    return { tasks, spans };
  }

  it('a chain longer than the pull limit still ends consistent (fixed wins, nobody overlaps)', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', wakeTime: '08:00', sleepTime: '12:00', horizonDays: 3 });
    // Eight 30-min flexibles pack 08:00–12:00: displacing the first needs 8 pulls (> 6).
    for (let i = 0; i < 8; i += 1) await flexible(`F${i}`, 30);
    const before = await expectInvariants();
    expect(before.spans).toHaveLength(8);

    const anchor = await fixed('Anchor', '2026-11-05', '08:00', '08:30');

    expect(await kit.slotsOf(anchor.id)).toEqual(['2026-11-05 08:00-08:30']);
    const after = await expectInvariants();
    // Nobody vanished: 8 flexibles + the anchor are each seated or parked.
    expect(after.tasks).toHaveLength(9);
  });

  it('a fixed event across midnight is stored whole and blocks both days', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', wakeTime: '00:00', sleepTime: '23:59', horizonDays: 3 });
    const night = await fixed('Evening shift', '2026-11-05', '20:00', '22:00');
    const late = await create({
      name: 'Night shift 2',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-05', '23:30').toISOString(),
      scheduledEndTime: kit.at('2026-11-06', '01:30').toISOString(),
    });
    const rows = await kit.slotRepo.find({ where: { taskId: late.id } });
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].scheduledEndTime).getTime() - new Date(rows[0].scheduledStartTime).getTime()).toBe(
      120 * 60_000,
    );
    // A flexible task asking for 00:30 on the next day hits the shift: a
    // conflict, never a seat inside it.
    const early = await flexible('Early', 30, { scheduledStartTime: kit.at('2026-11-06', '00:30').toISOString() });
    expect((await jobConflicts(early.jobId)).length).toBeGreaterThan(0);
    for (const row of await kit.slotRepo.find({ where: { taskId: early.id } })) {
      expect(new Date(row.scheduledStartTime).getTime()).toBeGreaterThanOrEqual(kit.at('2026-11-06', '01:30').getTime());
    }
    expect(await kit.slotsOf(night.id)).toHaveLength(1);
    await expectInvariants([early.id]);
  });

  it('a very long task is placed whole; one longer than any window parks instead of splitting or overlapping', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', wakeTime: '08:00', sleepTime: '20:00', horizonDays: 3 });
    const long = await flexible('Long', 600);
    const [slot] = await kit.slotRepo.find({ where: { taskId: long.id } });
    expect(new Date(slot.scheduledEndTime).getTime() - new Date(slot.scheduledStartTime).getTime()).toBe(600 * 60_000);

    const huge = await flexible('Huge', 13 * 60);
    expect(await kit.slotsOf(huge.id)).toEqual([]);
    expect((await kit.reload(huge.id)).scheduleState).toBe(ScheduleState.PROBLEMATIC);
    await expectInvariants();
  });

  it('a full window over the whole horizon parks a new flexible task', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', wakeTime: '08:00', sleepTime: '10:00', horizonDays: 2 });
    for (const ymd of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) await fixed(`Wall ${ymd}`, ymd, '08:00', '10:00');
    const extra = await flexible('Extra', 60, { deadline: kit.at('2026-11-06', '10:00').toISOString() });
    expect(await kit.slotsOf(extra.id)).toEqual([]);
    expect((await kit.reload(extra.id)).scheduleState).toBe(ScheduleState.PROBLEMATIC);
    await expectInvariants();
  });

  it('placing the same task again is idempotent (same slot, one row)', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z' });
    const task = await flexible('Once', 45);
    const first = await kit.slotsOf(task.id);
    for (let i = 0; i < 3; i += 1) {
      await kit.service.place(kit.user.id, task.id, {});
    }
    expect(await kit.slotsOf(task.id)).toEqual(first);
    expect(await kit.slotRepo.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('a preferred time that hits a fixed event asks (conflict), never sits on top', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z' });
    const meeting = await fixed('Meeting', '2026-11-05', '10:00', '11:00');
    const task = await flexible('Prefers 10', 60, { scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString() });
    // An explicit time on an anchor is the user's call (engine doc 6.2.1): a
    // conflict sheet, and the task never sits on the meeting.
    expect((await jobConflicts(task.jobId)).length).toBeGreaterThan(0);
    for (const slot of await kit.slotsOf(task.id)) expect(slot).not.toContain('10:00-11:00');
    expect(await kit.slotsOf(meeting.id)).toEqual(['2026-11-05 10:00-11:00']);
    await expectInvariants([task.id]);
  });

  it('a series covers exactly its horizon, and a later append adds days without duplicates', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', horizonDays: 3 });
    const series = await create({
      name: 'Daily',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '09:00').toISOString(),
      estimatedTimeInMinutes: 30,
    });
    const days = (await kit.slotsOf(series.id)).map((row) => row.slice(0, 10));
    expect(days).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);

    jest.setSystemTime(new Date('2026-11-07T07:00:00.000Z'));
    await kit.service.appendMissingSeriesDays(kit.user.id);
    await kit.service.appendMissingSeriesDays(kit.user.id);
    const later = (await kit.slotsOf(series.id)).map((row) => row.slice(0, 10));
    expect(new Set(later).size).toBe(later.length);
    expect(later).toEqual(expect.arrayContaining(['2026-11-08', '2026-11-09']));
    expect(later.every((row) => row <= '2026-11-09')).toBe(true);
  });

  it('a series clock edit while its create placement is still queued ends on the new clock only', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', horizonDays: 3 });
    // The create's in-request run is lost (crash); the job waits in the queue.
    jest.spyOn(kit.jobs, 'runNow').mockResolvedValueOnce(undefined as never);
    const series = (await kit.tasksService.create(kit.user.id, {
      name: 'Standup',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '09:00').toISOString(),
      estimatedTimeInMinutes: 30,
      timeZone: 'UTC',
    } as never)) as Task;
    expect(await kit.slotsOf(series.id)).toEqual([]);

    await kit.tasksService.update(series.id, kit.user.id, {
      scheduledStartTime: kit.at('2026-11-05', '14:00').toISOString(),
    } as never);
    await kit.jobs.settle();
    await kit.jobs.processDue();
    await kit.jobs.settle();

    expect(await kit.slotsOf(series.id)).toEqual([
      '2026-11-05 14:00-14:30',
      '2026-11-06 14:00-14:30',
      '2026-11-07 14:00-14:30',
    ]);
  });

  it('a daily series at 02:30 New York keeps one occurrence on the spring-forward day', async () => {
    kit = await createPlacementKit({
      now: '2027-03-13T05:00:00.000Z',
      timeZone: 'America/New_York',
      wakeTime: '00:00',
      sleepTime: '23:59',
      horizonDays: 3,
    });
    const series = await create({
      name: 'Pills',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2027-03-13', '02:30').toISOString(),
      estimatedTimeInMinutes: 15,
    });
    const rows = await kit.slotsOf(series.id);
    const days = rows.map((row) => row.slice(0, 10));
    // 02:30 does not exist on 14 March: that day is 03:30 (RFC 5545, as Google
    // renders the RRULE) and stays in the series — no detached copy.
    expect(days).toEqual(['2027-03-13', '2027-03-14', '2027-03-15']);
    expect(rows).toEqual(['2027-03-13 02:30-02:45', '2027-03-14 03:30-03:45', '2027-03-15 02:30-02:45']);
    const all = await kit.taskRepo.find();
    expect(all).toHaveLength(1);
    expect(all[0].skippedOccurrenceYmds ?? []).toEqual([]);
    await expectInvariants();
  });
});
