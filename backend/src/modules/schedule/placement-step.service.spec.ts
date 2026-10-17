import { PlacementStepService } from './placement-step.service';
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, TaskStatus } from '../tasks/entities/task.entity';
import { localDateTimeIso } from '../voice/voice-local-date.util';

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
      startTime: '09:00',
      endTime: '12:00',
      weekDays: null as number[] | null,
    };

    const taskRepo = {
      findOne: jest.fn().mockResolvedValue({
        ...claim,
        phase,
        phases: [phase],
      }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row) => row),
    };

    const scheduledRepo = {
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row) => row),
      remove: jest.fn(),
    };

    const externalBusy = {
      listVisibleEvents: jest.fn().mockResolvedValue(opts.googleEvents ?? []),
    };

    const service = new PlacementStepService(
      { transaction: jest.fn(async (fn) => fn({})) } as never,
      taskRepo as never,
      scheduledRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          timeZone: TZ,
          wakeTime: '08:00',
          sleepTime: '23:00',
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

    return { service, externalBusy };
  }

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
});
