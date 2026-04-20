import {
  IntelligentSchedulingEngine,
  SchedulingWarningCode,
} from './intelligent-scheduling.engine';
import { Task, TaskPriority, TaskStatus } from '../tasks/entities/task.entity';
import { TaskEventType } from '../scheduling/event-type.enum';
import { Phase } from '../event-phases/entities/phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

type MockRepo = {
  find: jest.Mock;
  save: jest.Mock;
  create?: jest.Mock;
  createQueryBuilder?: jest.Mock;
};

describe('IntelligentSchedulingEngine', () => {
  let engine: IntelligentSchedulingEngine;
  let taskRepo: MockRepo;
  let scheduledRepo: MockRepo;
  let getSettingsMock: jest.Mock;

  const userId = 'user-1';
  const phaseWorkday = makePhase('phase-1', '09:00', '12:00', [1, 2, 3, 4, 5]);
  const baseSettings = makeSettings({
    wakeTime: '09:00',
    sleepTime: '12:00',
    weekendWorkEnabled: false,
    recurringScheduleHorizonDays: 3,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T00:00:00.000Z')); // Monday

    taskRepo = {
      find: jest.fn(),
      save: jest.fn(async (entity: Task) => entity),
    };

    const selectQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const deleteQb = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };

    scheduledRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn(async (row) => row),
      createQueryBuilder: jest.fn((alias?: string) =>
        alias ? selectQb : deleteQb,
      ),
    };

    getSettingsMock = jest.fn().mockResolvedValue(baseSettings);

    engine = new IntelligentSchedulingEngine(
      taskRepo as never,
      scheduledRepo as never,
      {
        getSettings: getSettingsMock,
      } as never,
      {
        getEvents: jest.fn(),
      } as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('places recurring tasks by priority into exact target slots', async () => {
    const high = makeTask({
      id: 'r1',
      name: 'R1',
      priority: TaskPriority.HIGH,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phaseWorkday],
    });
    const low = makeTask({
      id: 'r2',
      name: 'R2',
      priority: TaskPriority.MEDIUM,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phaseWorkday],
    });
    taskRepo.find.mockResolvedValue([high, low]);

    await engine.run(userId);

    const [highSlots, lowSlots] = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(highSlots).toEqual([
      [atLocalTimeIso(0, 9), atLocalTimeIso(0, 10)],
      [atLocalTimeIso(1, 9), atLocalTimeIso(1, 10)],
      [atLocalTimeIso(2, 9), atLocalTimeIso(2, 10)],
    ]);
    expect(lowSlots).toEqual([
      [atLocalTimeIso(0, 10), atLocalTimeIso(0, 11)],
      [atLocalTimeIso(1, 10), atLocalTimeIso(1, 11)],
      [atLocalTimeIso(2, 10), atLocalTimeIso(2, 11)],
    ]);
  });

  it('uses FIFO for same priority recurring conflicts', async () => {
    const first = makeTask({
      id: 'fifo-1',
      name: 'First',
      createdAt: new Date('2026-04-20T08:01:00.000Z'),
      priority: TaskPriority.MEDIUM,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phaseWorkday],
    });
    const second = makeTask({
      id: 'fifo-2',
      name: 'Second',
      createdAt: new Date('2026-04-20T08:02:00.000Z'),
      priority: TaskPriority.MEDIUM,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phaseWorkday],
    });
    taskRepo.find.mockResolvedValue([first, second]);

    await engine.run(userId);

    const [firstSlots, secondSlots] = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(firstSlots[0]).toEqual([
      atLocalTimeIso(0, 9),
      atLocalTimeIso(0, 10),
    ]);
    expect(secondSlots[0]).toEqual([
      atLocalTimeIso(0, 10),
      atLocalTimeIso(0, 11),
    ]);
  });

  it('creates all recurring occurrences when daily capacity is enough', async () => {
    taskRepo.find.mockResolvedValue([
      makeTask({
        id: 'a',
        name: 'A',
        priority: TaskPriority.HIGH,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [phaseWorkday],
      }),
      makeTask({
        id: 'b',
        name: 'B',
        priority: TaskPriority.MEDIUM,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [phaseWorkday],
      }),
      makeTask({
        id: 'c',
        name: 'C',
        priority: TaskPriority.LOW,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [phaseWorkday],
      }),
    ]);

    await engine.run(userId);

    const segments = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(segments).toHaveLength(3);
    for (const taskSegments of segments) {
      expect(taskSegments).toHaveLength(3);
    }
  });

  it('fits four recurring tasks into a 2-hour phase when some have no preferred start', async () => {
    const twoHourPhase = makePhase('phase-2h', '09:00', '11:00', [1, 2, 3, 4, 5]);
    const settings = makeSettings({
      wakeTime: '09:00',
      sleepTime: '11:00',
      recurringScheduleHorizonDays: 1,
      allowSplitScheduling: false,
    });
    (engine as any).userSettingsService.getSettings.mockResolvedValue(settings);

    taskRepo.find.mockResolvedValue([
      makeTask({
        id: 'rec-1',
        name: 'Rec 1',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        eventType: TaskEventType.DAILY_ROUTINE,
        estimatedTimeInMinutes: 30,
        scheduledStartTime: new Date(atLocalTimeIso(0, 9)),
        scheduledEndTime: new Date(atLocalTimeWithMinutesIso(0, 9, 30)),
        phases: [twoHourPhase],
      }),
      makeTask({
        id: 'rec-2',
        name: 'Rec 2',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        eventType: TaskEventType.DAILY_ROUTINE,
        estimatedTimeInMinutes: 20,
        scheduledStartTime: null,
        scheduledEndTime: null,
        phases: [twoHourPhase],
      }),
      makeTask({
        id: 'rec-3',
        name: 'Rec 3',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        eventType: TaskEventType.DAILY_ROUTINE,
        estimatedTimeInMinutes: 30,
        scheduledStartTime: new Date(atLocalTimeIso(0, 10)),
        scheduledEndTime: new Date(atLocalTimeWithMinutesIso(0, 10, 30)),
        phases: [twoHourPhase],
      }),
      makeTask({
        id: 'rec-4',
        name: 'Rec 4',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 20,
        phases: [twoHourPhase],
      }),
    ]);

    const result = await engine.run(userId);

    const byTask = extractTaskSegmentsByTaskId(scheduledRepo.save.mock.calls);
    expect(byTask.get('rec-1')).toEqual([
      [atLocalTimeIso(0, 9), atLocalTimeWithMinutesIso(0, 9, 30)],
    ]);
    expect(byTask.get('rec-3')).toEqual([
      [atLocalTimeIso(0, 10), atLocalTimeWithMinutesIso(0, 10, 30)],
    ]);
    expect(byTask.get('rec-2')).toEqual([
      [atLocalTimeWithMinutesIso(0, 9, 30), atLocalTimeWithMinutesIso(0, 9, 50)],
    ]);
    expect(byTask.get('rec-4')).toEqual([
      [atLocalTimeWithMinutesIso(0, 10, 30), atLocalTimeWithMinutesIso(0, 10, 50)],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.code === SchedulingWarningCode.OCCURRENCE_SKIPPED),
    ).toBe(false);
  });

  it('skips overflowing recurring occurrences and returns warning', async () => {
    const narrowPhase = makePhase('phase-narrow', '09:00', '11:00', [1, 2, 3, 4, 5]);
    taskRepo.find.mockResolvedValue([
      makeTask({
        id: 'fit-1',
        name: 'Fit 1',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [narrowPhase],
      }),
      makeTask({
        id: 'fit-2',
        name: 'Fit 2',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [narrowPhase],
      }),
      makeTask({
        id: 'skip-3',
        name: 'Skip 3',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [narrowPhase],
      }),
    ]);

    const result = await engine.run(userId);

    const byTask = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(byTask[0]).toHaveLength(3);
    expect(byTask[1]).toHaveLength(3);
    expect(byTask[2]).toBeUndefined();
    expect(
      result.warnings.some(
        (w) =>
          w.code === SchedulingWarningCode.OCCURRENCE_SKIPPED &&
          w.taskName === 'Skip 3' &&
          (w.meta?.skippedOccurrences as number) === 3,
      ),
    ).toBe(true);
  });

  it('keeps fixed tasks as anchors and moves recurring to next exact slot', async () => {
    const fixed = makeTask({
      id: 'fixed',
      name: 'Fixed',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: new Date(atLocalTimeIso(0, 9)),
      scheduledEndTime: new Date(atLocalTimeIso(0, 10)),
      phases: [phaseWorkday],
    });
    const recurring = makeTask({
      id: 'movable',
      name: 'Movable',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phaseWorkday],
    });
    taskRepo.find.mockResolvedValue([fixed, recurring]);

    await engine.run(userId);

    const [recurringSlots] = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(recurringSlots[0]).toEqual([
      atLocalTimeIso(0, 10),
      atLocalTimeIso(0, 11),
    ]);
  });

  it('trims DAILY recurring by phase weekdays', async () => {
    const settings = makeSettings({
      wakeTime: '09:00',
      sleepTime: '12:00',
      weekendWorkEnabled: true,
      recurringScheduleHorizonDays: 7,
    });
    (engine as any).userSettingsService.getSettings.mockResolvedValue(settings);
    taskRepo.find.mockResolvedValue([
      makeTask({
        id: 'weekly',
        name: 'Weekdays only',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [phaseWorkday],
      }),
    ]);

    await engine.run(userId);

    const [slots] = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(slots).toHaveLength(5);
    expect(slots.map((s) => s[0].slice(0, 10))).toEqual([
      atLocalTimeIso(0, 9).slice(0, 10),
      atLocalTimeIso(1, 9).slice(0, 10),
      atLocalTimeIso(2, 9).slice(0, 10),
      atLocalTimeIso(3, 9).slice(0, 10),
      atLocalTimeIso(4, 9).slice(0, 10),
    ]);
  });

  it('respects overnight phase windows', async () => {
    const overnight = makePhase('overnight', '22:00', '06:00', [1, 2, 3, 4, 5, 6, 0]);
    const settings = makeSettings({
      wakeTime: '22:00',
      sleepTime: '06:00',
      weekendWorkEnabled: true,
      recurringScheduleHorizonDays: 1,
    });
    (engine as any).userSettingsService.getSettings.mockResolvedValue(settings);
    taskRepo.find.mockResolvedValue([
      makeTask({
        id: 'n1',
        name: 'Night 1',
        estimatedTimeInMinutes: 120,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [overnight],
      }),
      makeTask({
        id: 'n2',
        name: 'Night 2',
        estimatedTimeInMinutes: 120,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        phases: [overnight],
      }),
    ]);

    await engine.run(userId);

    const [first, second] = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(first[0]).toEqual([
      atLocalTimeIso(0, 22),
      atLocalTimeIso(1, 0),
    ]);
    expect(second[0]).toEqual([
      atLocalTimeIso(1, 0),
      atLocalTimeIso(1, 2),
    ]);
  });

  it('places non-recurring task outside horizon and emits warning', async () => {
    const settings = makeSettings({
      wakeTime: '09:00',
      sleepTime: '10:00',
      recurringScheduleHorizonDays: 1,
    });
    (engine as any).userSettingsService.getSettings.mockResolvedValue(settings);
    const longTask = makeTask({
      id: 'outside',
      name: 'Outside horizon',
      estimatedTimeInMinutes: 120,
      isRecurring: false,
      allowSplit: true,
      phases: [makePhase('long', '09:00', '10:00', [1, 2, 3, 4, 5, 6, 0])],
    });
    taskRepo.find.mockResolvedValue([longTask]);

    const result = await engine.run(userId);

    const [segments] = extractTaskSegments(scheduledRepo.save.mock.calls);
    expect(segments).toHaveLength(2);
    expect(segments[0][0]).toBe(atLocalTimeIso(0, 9));
    expect(segments[1][0]).toBe(atLocalTimeIso(1, 9));
    expect(
      result.warnings.some(
        (w) =>
          w.code === SchedulingWarningCode.OUTSIDE_HORIZON &&
          w.taskId === 'outside' &&
          (w.meta?.horizonDays as number) === 1,
      ),
    ).toBe(true);
  });

  it('does not treat own synced Google events as external busy when replanning', async () => {
    const phase911 = makePhase('phase-911', '09:00', '11:00', [1, 2, 3, 4, 5]);
    const googleSvc = (engine as any).googleCalendarService as {
      getEvents: jest.Mock;
    };

    const t1 = makeTask({
      id: 'own-sync-1',
      name: 'R1',
      createdAt: new Date('2026-04-20T08:01:00.000Z'),
      estimatedTimeInMinutes: 30,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phase911],
      scheduledStartTime: new Date(atLocalTimeWithMinutesIso(0, 9, 0)),
      scheduledEndTime: new Date(atLocalTimeWithMinutesIso(0, 9, 30)),
      googleEventId: 'google-master-1',
    });
    const t2 = makeTask({
      id: 'own-sync-2',
      name: 'R2',
      createdAt: new Date('2026-04-20T08:02:00.000Z'),
      estimatedTimeInMinutes: 20,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phase911],
      scheduledStartTime: new Date(atLocalTimeWithMinutesIso(0, 9, 30)),
      scheduledEndTime: new Date(atLocalTimeWithMinutesIso(0, 9, 50)),
      googleEventId: 'google-master-2',
    });
    const t3 = makeTask({
      id: 'own-sync-3',
      name: 'R3',
      createdAt: new Date('2026-04-20T08:03:00.000Z'),
      estimatedTimeInMinutes: 30,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      phases: [phase911],
      scheduledStartTime: new Date(atLocalTimeWithMinutesIso(0, 10, 0)),
      scheduledEndTime: new Date(atLocalTimeWithMinutesIso(0, 10, 30)),
      googleEventId: 'google-master-3',
    });

    getSettingsMock.mockResolvedValueOnce(
      makeSettings({
        googleCalendarLinked: true,
        recurringScheduleHorizonDays: 2,
        wakeTime: '08:00',
        sleepTime: '23:00',
      }),
    );

    googleSvc.getEvents.mockResolvedValue({
      events: [
        {
          id: 'google-master-1_20260420',
          recurringEventId: 'google-master-1',
          status: 'confirmed',
          start: { dateTime: '2026-04-20T09:00:00.000Z' },
          end: { dateTime: '2026-04-20T09:30:00.000Z' },
        },
        {
          id: 'google-master-2_20260420',
          recurringEventId: 'google-master-2',
          status: 'confirmed',
          start: { dateTime: '2026-04-20T09:30:00.000Z' },
          end: { dateTime: '2026-04-20T09:50:00.000Z' },
        },
        {
          id: 'google-master-3_20260420',
          recurringEventId: 'google-master-3',
          status: 'confirmed',
          start: { dateTime: '2026-04-20T10:00:00.000Z' },
          end: { dateTime: '2026-04-20T10:30:00.000Z' },
        },
      ],
      nextPageToken: undefined,
    });

    taskRepo.find.mockResolvedValue([t1, t2, t3]);

    const { errors } = await engine.run(userId);

    expect(errors).toHaveLength(0);
    const byTask = extractTaskSegmentsByTaskId(scheduledRepo.save.mock.calls);
    expect(byTask.get('own-sync-1')?.length).toBeGreaterThan(0);
    expect(byTask.get('own-sync-2')?.length).toBeGreaterThan(0);
    expect(byTask.get('own-sync-3')?.length).toBeGreaterThan(0);
  });
});

let taskCounter = 0;

function makePhase(
  id: string,
  startTime: string,
  endTime: string,
  weekDays: number[] | null,
): Phase {
  return {
    id,
    name: id,
    color: '#000000',
    description: null,
    startTime,
    endTime,
    parentPhaseId: null,
    weekDays,
    type: 'time_phase',
    userId: 'user-1',
    tasks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSettings(partial: Partial<UserSettings>): UserSettings {
  return {
    id: 'settings-1',
    userId: 'user-1',
    user: undefined as never,
    wakeTime: '09:00',
    sleepTime: '12:00',
    defaultWorkBlockDuration: 25,
    defaultBreakDuration: 5,
    defaultLunchDuration: 60,
    preferredLunchTime: '12:00',
    weekendWorkEnabled: false,
    googleCalendarLinked: false,
    allowSplitScheduling: true,
    minSplitMinutes: 30,
    maxSplitMinutes: 60,
    recurringScheduleHorizonDays: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function makeTask(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? `task-${++taskCounter}`,
    name: partial.name ?? 'Task',
    description: partial.description ?? '',
    userId: partial.userId ?? 'user-1',
    user: undefined as never,
    phaseId: null,
    phase: undefined as never,
    phases: partial.phases ?? [],
    eventType: partial.eventType ?? TaskEventType.ADMIN,
    estimatedTimeInMinutes: partial.estimatedTimeInMinutes ?? 60,
    isRecurring: partial.isRecurring ?? false,
    recurrencePattern: partial.recurrencePattern ?? null,
    allowSplit: partial.allowSplit ?? false,
    priority: partial.priority ?? TaskPriority.MEDIUM,
    deadline: partial.deadline ?? null,
    status: partial.status ?? TaskStatus.TODO,
    scheduledStartTime: partial.scheduledStartTime ?? null,
    scheduledEndTime: partial.scheduledEndTime ?? null,
    googleEventId: partial.googleEventId ?? null,
    isFixedExternal: false,
    createdAt: partial.createdAt ?? new Date('2026-04-20T08:00:00.000Z'),
    updatedAt: new Date('2026-04-20T08:00:00.000Z'),
  };
}

function extractTaskSegments(calls: unknown[][]): string[][][] {
  const map = new Map<string, string[][]>();
  for (const [row] of calls as Array<[any]>) {
    if (!row?.taskId || !row?.scheduledStartTime || !row?.scheduledEndTime) continue;
    const list = map.get(row.taskId) ?? [];
    list.push([
      new Date(row.scheduledStartTime).toISOString(),
      new Date(row.scheduledEndTime).toISOString(),
    ]);
    map.set(row.taskId, list);
  }
  return [...map.values()];
}

function atLocalTimeIso(dayOffset: number, hours: number): string {
  const local = new Date('2026-04-20T00:00:00.000Z');
  local.setDate(local.getDate() + dayOffset);
  local.setHours(hours, 0, 0, 0);
  return local.toISOString();
}

function atLocalTimeWithMinutesIso(
  dayOffset: number,
  hours: number,
  minutes: number,
): string {
  const local = new Date('2026-04-20T00:00:00.000Z');
  local.setDate(local.getDate() + dayOffset);
  local.setHours(hours, minutes, 0, 0);
  return local.toISOString();
}

function extractTaskSegmentsByTaskId(calls: unknown[][]): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  for (const [row] of calls as Array<[any]>) {
    if (!row?.taskId || !row?.scheduledStartTime || !row?.scheduledEndTime) continue;
    const list = map.get(row.taskId) ?? [];
    list.push([
      new Date(row.scheduledStartTime).toISOString(),
      new Date(row.scheduledEndTime).toISOString(),
    ]);
    map.set(row.taskId, list);
  }
  return map;
}
