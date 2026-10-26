import {
  durationsMatch,
  followWindowToDrop,
  PlacementStepService,
  seriesBlockMinutes,
} from './placement-step.service';
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, Task, TaskStatus } from '../tasks/entities/task.entity';
import { addDaysToYmd, localDateTimeIso } from '../voice/voice-local-date.util';

const TZ = 'UTC';

/** First UTC civil day whose 09:00 is still in the future (inside the 14-day horizon). */
function firstFreeMorningYmd(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = Date.now();
  for (let offset = 1; offset < 14; offset += 1) {
    const ymd = fmt.format(new Date(now + offset * 24 * 60 * 60 * 1000));
    const morning = Date.parse(localDateTimeIso(ymd, '09:00', TZ));
    if (morning > now) return ymd;
  }
  throw new Error('no free UTC morning in the next 14 days');
}

describe('PlacementStepService.place (dryRun crowded day)', () => {
  const ymd = firstFreeMorningYmd();
  const wall = (hm: string) => new Date(localDateTimeIso(ymd, hm, TZ));

  function baseTask(partial: Record<string, unknown>) {
    return {
      id: 'claim-1',
      userId: 'user-1',
      name: 'Claimant',
      eventType: TaskEventType.ADMIN,
      status: TaskStatus.TODO,
      scheduleState: ScheduleState.NONE,
      isUnscheduled: false,
      isRecurring: false,
      isFixedExternal: false,
      estimatedTimeInMinutes: 60,
      scheduledStartTime: null,
      scheduledEndTime: null,
      earliestStartTime: null,
      deadline: null,
      phase: null,
      phases: [],
      phaseId: 'phase-1',
      ...partial,
    };
  }

  function build(opts: {
    claim: Record<string, unknown>;
    peerSlots?: Array<{
      id: string;
      task: Record<string, unknown>;
      start: string;
      end: string;
    }>;
    googleEvents?: Array<{
      id: string;
      summary?: string;
      transparency?: string;
      start: { dateTime: string };
      end: { dateTime: string };
    }>;
    linked?: boolean;
    /** Schedulable phase on the user. Claim stays unphased when `attachPhase` is false. */
    phaseWindow?: { startTime: string; endTime: string };
    attachPhase?: boolean;
    wakeTime?: string;
    sleepTime?: string;
  }) {
    const claim = baseTask(opts.claim);
    const peerSlots = opts.peerSlots ?? [];
    const slots = peerSlots.map((row) => ({
      id: row.id,
      taskId: row.task.id,
      scheduledStartTime: wall(row.start),
      scheduledEndTime: wall(row.end),
      googleEventId: null,
      task: baseTask(row.task),
    }));

    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(slots),
    };

    const phase = {
      id: 'phase-1',
      type: 'time_phase',
      startTime: opts.phaseWindow?.startTime ?? '09:00',
      endTime: opts.phaseWindow?.endTime ?? '12:00',
      weekDays: null as number[] | null,
    };
    const attachPhase = opts.attachPhase !== false;

    const taskRepo = {
      findOne: jest.fn().mockResolvedValue({
        ...claim,
        phaseId: attachPhase ? 'phase-1' : null,
        phase: attachPhase ? phase : null,
        phases: attachPhase ? [phase] : [],
      }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row) => row),
    };

    const scheduledRepo = {
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row) => row),
      remove: jest.fn(),
      create: jest.fn((row) => row),
    };

    const externalBusy = {
      listVisibleEvents: jest.fn().mockResolvedValue(opts.googleEvents ?? []),
    };

    const service = new PlacementStepService(
      { transaction: jest.fn(async (fn) => fn({})) } as never,
      taskRepo as never,
      scheduledRepo as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          timeZone: TZ,
          wakeTime: opts.wakeTime ?? '08:00',
          sleepTime: opts.sleepTime ?? '23:00',
          weekendWorkEnabled: true,
          googleCalendarLinked: opts.linked !== false,
          recurringScheduleHorizonDays: 14,
          fixedEventBufferMinutes: 0,
        }),
      } as never,
      {
        findAllForScheduling: jest.fn().mockResolvedValue([phase]),
      } as never,
      { syncTask: jest.fn() } as never,
      externalBusy as never,
    );

    return { service, externalBusy, taskRepo, scheduledRepo, phase };
  }

  it('PV01 previews an unsaved draft task without loading it', async () => {
    const { service, taskRepo, phase } = build({
      claim: { id: 'unused' },
      peerSlots: [
        {
          id: 'slot-a',
          start: '09:00',
          end: '10:00',
          task: { id: 'peer-a', name: 'Peer A', eventType: TaskEventType.ADMIN },
        },
      ],
      linked: false,
    });
    const draft = baseTask({ id: 'draft:1', name: 'Draft', phase, phases: [phase] });

    const plan = await service.previewPlacement('user-1', {
      task: draft as never,
      windowYmd: ymd,
    });
    expect(taskRepo.findOne).not.toHaveBeenCalled();
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(wall('10:00').getTime());
  });

  it('PV02 extra seats block proposed items and ignored tasks free their slot', async () => {
    const { service, phase } = build({
      claim: { id: 'unused' },
      peerSlots: [
        {
          id: 'slot-a',
          start: '09:00',
          end: '10:00',
          task: { id: 'peer-a', name: 'Peer A', eventType: TaskEventType.ADMIN },
        },
      ],
      linked: false,
    });
    const draft = baseTask({ id: 'draft:2', name: 'Draft', phase, phases: [phase] });
    const proposed = {
      id: 'plan:x',
      taskId: 'plan:x',
      taskName: 'Proposed',
      role: 'anchor' as const,
      start: wall('10:00').getTime(),
      end: wall('11:00').getTime(),
      windows: [],
      notBefore: Date.now(),
    };

    const blocked = await service.previewPlacement('user-1', {
      task: draft as never,
      windowYmd: ymd,
      extraSeats: [proposed],
    });
    expect(blocked.outcome).toBe('seated');
    if (blocked.outcome !== 'seated') return;
    expect(blocked.start).toBe(wall('11:00').getTime());

    const freed = await service.previewPlacement('user-1', {
      task: draft as never,
      windowYmd: ymd,
      ignoreTaskIds: ['peer-a'],
    });
    expect(freed.outcome).toBe('seated');
    if (freed.outcome !== 'seated') return;
    expect(freed.start).toBe(wall('09:00').getTime());
  });

  it('PV03 a preferred start that would shift a peer falls back to a free hole', async () => {
    const { service, phase } = build({
      claim: { id: 'unused' },
      peerSlots: [
        {
          id: 'slot-a',
          start: '09:00',
          end: '10:00',
          task: { id: 'peer-a', name: 'Peer A', eventType: TaskEventType.ADMIN },
        },
      ],
      linked: false,
    });
    const draft = baseTask({ id: 'draft:3', name: 'Draft', phase, phases: [phase] });

    const plan = await service.previewPlacement('user-1', {
      task: draft as never,
      windowYmd: ymd,
      preferredStart: wall('09:00'),
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.moves).toEqual([]);
    expect(plan.start).toBe(wall('10:00').getTime());
  });

  it('CD01 seats a no-preferred claim in the free hole without moving peers', async () => {
    const { service } = build({
      claim: {
        id: 'new',
        name: 'New',
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
      peerSlots: [
        {
          id: 'slot-a',
          start: '09:00',
          end: '10:00',
          task: {
            id: 'peer-a',
            name: 'Peer A',
            eventType: TaskEventType.ADMIN,
          },
        },
      ],
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      searchHole: true,
      windowYmd: ymd,
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(wall('10:00').getTime());
    expect(plan.end).toBe(wall('11:00').getTime());
    expect(plan.moves).toEqual([]);
  });

  it('CD03 preferred on flexible shifts the peer (dryRun plan)', async () => {
    const { service } = build({
      claim: {
        id: 'new',
        name: 'New',
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('10:00'),
      },
      peerSlots: [
        {
          id: 'slot-a',
          start: '09:00',
          end: '10:00',
          task: {
            id: 'peer-a',
            name: 'Peer A',
            eventType: TaskEventType.ADMIN,
          },
        },
      ],
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      windowYmd: ymd,
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(wall('09:00').getTime());
    expect(plan.moves.some((m) => m.kind === 'shift' && m.taskId === 'peer-a')).toBe(
      true,
    );
  });

  it('CD04 / T14 preferred on fixed returns conflict and does not seat', async () => {
    const { service } = build({
      claim: {
        id: 'new',
        name: 'New',
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('10:00'),
      },
      peerSlots: [
        {
          id: 'slot-f',
          start: '09:00',
          end: '10:00',
          task: {
            id: 'fixed-1',
            name: 'Fixed',
            eventType: TaskEventType.FIXED,
          },
        },
      ],
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      windowYmd: ymd,
    });
    expect(plan.outcome).toBe('conflict');
    if (plan.outcome !== 'conflict') return;
    expect(plan.conflict.options).toEqual([
      'place_on_top',
      'move_new',
      'leave_problematic',
    ]);
  });

  it('CD07 fixed vs fixed returns conflict', async () => {
    const { service } = build({
      claim: {
        id: 'new-fixed',
        name: 'Fixed B',
        eventType: TaskEventType.FIXED,
        scheduledStartTime: wall('09:30'),
        scheduledEndTime: wall('10:30'),
      },
      peerSlots: [
        {
          id: 'slot-f',
          start: '09:00',
          end: '10:00',
          task: {
            id: 'fixed-1',
            name: 'Fixed A',
            eventType: TaskEventType.FIXED,
          },
        },
      ],
      linked: false,
    });

    const plan = await service.place('user-1', 'new-fixed', {
      dryRun: true,
      preferredStart: wall('09:30'),
      windowYmd: ymd,
    });
    expect(plan.outcome).toBe('conflict');
  });

  it('CD04 preferred on Google busy returns conflict', async () => {
    const { service, externalBusy } = build({
      claim: {
        id: 'new',
        name: 'New',
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('10:00'),
      },
      googleEvents: [
        {
          id: 'g-1',
          start: { dateTime: wall('09:00').toISOString() },
          end: { dateTime: wall('10:00').toISOString() },
        },
      ],
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      windowYmd: ymd,
    });
    expect(plan.outcome).toBe('conflict');
    expect(externalBusy.listVisibleEvents).toHaveBeenCalled();
  });

  it('CD04b preferred on a Microsoft event returns conflict; a free event does not', async () => {
    const blocking = build({
      claim: {
        id: 'new',
        name: 'New',
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('10:00'),
      },
      googleEvents: [
        {
          id: 'ms-1',
          summary: 'Outlook standup',
          start: { dateTime: wall('09:00').toISOString() },
          end: { dateTime: wall('10:00').toISOString() },
        },
      ],
    });
    const blocked = await blocking.service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      windowYmd: ymd,
    });
    expect(blocked.outcome).toBe('conflict');

    const free = build({
      claim: {
        id: 'new',
        name: 'New',
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('10:00'),
      },
      googleEvents: [
        {
          id: 'apple-free',
          summary: 'Available',
          transparency: 'transparent',
          start: { dateTime: wall('09:00').toISOString() },
          end: { dateTime: wall('10:00').toISOString() },
        },
      ],
    });
    const seated = await free.service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      windowYmd: ymd,
    });
    expect(seated.outcome).toBe('seated');
  });

  it('CD05 solid fill with no preferred → problematic', async () => {
    const { service } = build({
      claim: {
        id: 'new',
        name: 'New',
        estimatedTimeInMinutes: 60,
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
      peerSlots: [
        {
          id: 'a',
          start: '09:00',
          end: '10:00',
          task: { id: 'a', name: 'A', eventType: TaskEventType.FIXED },
        },
        {
          id: 'b',
          start: '10:00',
          end: '11:00',
          task: { id: 'b', name: 'B', eventType: TaskEventType.FIXED },
        },
        {
          id: 'c',
          start: '11:00',
          end: '12:00',
          task: { id: 'c', name: 'C', eventType: TaskEventType.FIXED },
        },
      ],
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      searchHole: true,
      windowYmd: ymd,
    });
    expect(plan.outcome).toBe('problematic');
  });

  it('CD06 expired deadline window → unscheduled for one-off flexible', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
    const { service } = build({
      claim: {
        id: 'new',
        name: 'Late',
        earliestStartTime: yesterday,
        deadline: yesterday,
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      searchHole: true,
    });
    expect(plan.outcome).toBe('unscheduled');
  });

  it('seats an unphased flexible at preferred 09:00 even when phases start later', async () => {
    const { service } = build({
      attachPhase: false,
      phaseWindow: { startTime: '14:00', endTime: '18:00' },
      wakeTime: '07:00',
      sleepTime: '23:00',
      claim: {
        id: 'new',
        name: 'Morning',
        phaseId: null,
        estimatedTimeInMinutes: 30,
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('09:30'),
      },
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      durationMinutes: 30,
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(wall('09:00').getTime());
    expect(plan.end).toBe(wall('09:30').getTime());
  });

  it('preferred outside the phase takes a free hole instead of Problematic', async () => {
    const { service } = build({
      phaseWindow: { startTime: '14:00', endTime: '18:00' },
      wakeTime: '07:00',
      sleepTime: '23:00',
      claim: {
        id: 'new',
        name: 'Afternoon',
        estimatedTimeInMinutes: 60,
        scheduledStartTime: wall('09:00'),
        scheduledEndTime: wall('10:00'),
      },
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('09:00'),
      durationMinutes: 60,
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(wall('14:00').getTime());
    expect(plan.end).toBe(wall('15:00').getTime());
  });

  it('does not use phase time before the task start', async () => {
    const { service } = build({
      phaseWindow: { startTime: '08:00', endTime: '12:00' },
      wakeTime: '07:00',
      sleepTime: '23:00',
      claim: {
        id: 'new',
        name: 'Afternoon',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: wall('15:00'),
        scheduledEndTime: wall('15:30'),
      },
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('15:00'),
      durationMinutes: 30,
    });
    expect(plan.outcome).toBe('problematic');
  });

  it('keeps an unphased hole search inside the task start, not earlier wake time', async () => {
    const { service } = build({
      attachPhase: false,
      wakeTime: '07:00',
      sleepTime: '23:00',
      claim: {
        id: 'new',
        name: 'Afternoon',
        phaseId: null,
        estimatedTimeInMinutes: 60,
        scheduledStartTime: wall('15:00'),
        scheduledEndTime: wall('16:00'),
      },
      peerSlots: [
        {
          id: 'resolved',
          start: '15:00',
          end: '16:00',
          task: {
            id: 'resolved',
            name: 'Kept',
            scheduleState: ScheduleState.RESOLVED,
          },
        },
      ],
      linked: false,
    });

    const plan = await service.place('user-1', 'new', {
      dryRun: true,
      preferredStart: wall('15:00'),
      durationMinutes: 60,
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(wall('16:00').getTime());
  });

  it('moves a resolved layer slot to the dragged interval', async () => {
    const { service, scheduledRepo } = build({
      claim: {
        eventType: TaskEventType.FIXED,
        scheduleState: ScheduleState.RESOLVED,
        scheduledStartTime: wall('21:15'),
        scheduledEndTime: wall('23:00'),
        estimatedTimeInMinutes: 105,
      },
      linked: false,
    });
    const slot = {
      id: 'slot-1',
      taskId: 'claim-1',
      scheduledStartTime: wall('18:00'),
      scheduledEndTime: wall('23:00'),
      googleEventId: 'g1',
    };
    scheduledRepo.find.mockResolvedValue([slot]);

    const plan = await service.place('user-1', 'claim-1');

    expect(plan).toMatchObject({
      outcome: 'seated',
      start: wall('21:15').getTime(),
      end: wall('23:00').getTime(),
    });
    expect(slot.scheduledStartTime).toEqual(wall('21:15'));
    expect(slot.scheduledEndTime).toEqual(wall('23:00'));
    expect(slot.googleEventId).toBe('g1');
    expect(scheduledRepo.save).toHaveBeenCalledTimes(1);
  });

  it('clears resolved when a resolved task is placed at a new clock', async () => {
    const { service, taskRepo, scheduledRepo } = build({
      claim: {
        eventType: TaskEventType.FIXED,
        scheduleState: ScheduleState.RESOLVED,
        scheduledStartTime: wall('18:00'),
        scheduledEndTime: wall('23:00'),
        estimatedTimeInMinutes: 300,
        parentSeriesId: 'series-1',
      },
      linked: false,
    });
    scheduledRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        taskId: 'claim-1',
        scheduledStartTime: wall('18:00'),
        scheduledEndTime: wall('23:00'),
        googleEventId: 'g1',
      },
    ]);

    const plan = await service.place('user-1', 'claim-1', {
      preferredStart: wall('21:15'),
      durationMinutes: 105,
    });

    expect(plan).toMatchObject({
      outcome: 'seated',
      start: wall('21:15').getTime(),
      end: wall('23:00').getTime(),
    });
    const saved = taskRepo.save.mock.calls.at(-1)?.[0] as {
      scheduleState: string;
      parentSeriesId: string | null;
      estimatedTimeInMinutes: number;
    };
    expect(saved.scheduleState).toBe(ScheduleState.NONE);
    expect(saved.parentSeriesId).toBeNull();
    expect(saved.estimatedTimeInMinutes).toBe(105);
  });

  it('lets an explicit drop overlap a resolved layer', async () => {
    const { service, taskRepo } = build({
      claim: {
        estimatedTimeInMinutes: 60,
        scheduledStartTime: wall('18:00'),
        scheduledEndTime: wall('19:00'),
      },
      attachPhase: false,
      wakeTime: '09:00',
      sleepTime: '23:00',
      peerSlots: [
        {
          id: 'layer',
          start: '16:00',
          end: '22:00',
          task: {
            id: 'layer-task',
            name: 'Layer',
            eventType: TaskEventType.FIXED,
            scheduleState: ScheduleState.RESOLVED,
          },
        },
      ],
      linked: false,
    });
    taskRepo.find.mockResolvedValue([
      {
        id: 'layer-task',
        name: 'Layer',
        eventType: TaskEventType.FIXED,
        scheduleState: ScheduleState.RESOLVED,
        status: TaskStatus.TODO,
        scheduledStartTime: wall('16:00'),
        scheduledEndTime: wall('22:00'),
        isUnscheduled: false,
      },
    ]);

    const dropped = await service.place('user-1', 'claim-1', {
      dryRun: true,
      commit: 'preferred',
      preferredStart: wall('20:00'),
      durationMinutes: 60,
    });
    expect(dropped).toMatchObject({
      outcome: 'seated',
      start: wall('20:00').getTime(),
    });

    const searched = await service.place('user-1', 'claim-1', {
      dryRun: true,
      preferredStart: wall('20:00'),
      durationMinutes: 60,
    });
    expect(searched.outcome).toBe('seated');
    if (searched.outcome !== 'seated') return;
    expect(searched.start).not.toBe(wall('20:00').getTime());
  });

  it('seats a drag on a later day that the old From/Until does not cover', async () => {
    const later = addDaysToYmd(ymd, 1);
    const laterAt = (hm: string) => new Date(localDateTimeIso(later, hm, TZ));
    const { service } = build({
      claim: {
        estimatedTimeInMinutes: 60,
        earliestStartTime: wall('09:00'),
        deadline: wall('12:00'),
        scheduledStartTime: wall('10:00'),
        scheduledEndTime: wall('11:00'),
      },
      linked: false,
    });

    const dropped = await service.place('user-1', 'claim-1', {
      dryRun: true,
      drag: true,
      commit: 'preferred',
      preferredStart: laterAt('10:00'),
      durationMinutes: 60,
    });
    expect(dropped).toMatchObject({
      outcome: 'seated',
      start: laterAt('10:00').getTime(),
    });

    const kept = await service.place('user-1', 'claim-1', {
      dryRun: true,
      commit: 'preferred',
      preferredStart: laterAt('10:00'),
      durationMinutes: 60,
    });
    expect(kept).toMatchObject({ outcome: 'problematic', reason: 'phase_full' });
  });
});

describe('followWindowToDrop', () => {
  const ymd = firstFreeMorningYmd();
  const wall = (hm: string) => new Date(localDateTimeIso(ymd, hm, TZ));

  it('shifts From/Until onto the drop day and keeps the local clocks', () => {
    const from = addDaysToYmd(ymd, -2);
    const task = {
      eventType: TaskEventType.ADMIN,
      isRecurring: false,
      earliestStartTime: new Date(localDateTimeIso(from, '14:30', TZ)),
      deadline: new Date(localDateTimeIso(from, '23:59', TZ)),
    } as Task;
    followWindowToDrop(task, wall('22:45').getTime(), wall('23:45').getTime(), TZ);
    expect(task.earliestStartTime?.toISOString()).toBe(wall('14:30').toISOString());
    expect(task.deadline?.toISOString()).toBe(wall('23:59').toISOString());
  });
});

describe('series re-merge duration', () => {
  it('keeps a resized block from rejoining the series length', () => {
    const series = {
      scheduledStartTime: '2026-10-24T09:00:00.000Z',
      scheduledEndTime: '2026-10-24T10:00:00.000Z',
      estimatedTimeInMinutes: 60,
    };
    expect(seriesBlockMinutes(series)).toBe(60);
    expect(
      durationsMatch(
        '2026-10-24T09:00:00.000Z',
        '2026-10-24T10:00:00.000Z',
        seriesBlockMinutes(series),
      ),
    ).toBe(true);
    expect(
      durationsMatch(
        '2026-10-24T09:00:00.000Z',
        '2026-10-24T11:00:00.000Z',
        seriesBlockMinutes(series),
      ),
    ).toBe(false);
  });
});
