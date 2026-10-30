import { BadRequestException } from '@nestjs/common';
import { parkedDays, ScheduleState, Task } from '../tasks/entities/task.entity';
import { TaskEventType } from '../scheduling/event-type.enum';
import { autoSeatOptions } from './placement-step.service';
import { ProblematicPlaceService } from './problematic-place.service';

const FUTURE = '2099-01-15';
const start = `${FUTURE}T14:00:00.000Z`;
const end = `${FUTURE}T15:00:00.000Z`;

function parkedTask(partial: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    name: 'Gym',
    eventType: TaskEventType.ADMIN,
    isRecurring: false,
    scheduleState: ScheduleState.PROBLEMATIC,
    problematicReason: 'no_slot',
    problematicDay: FUTURE,
    problematicOccurrenceYmds: [FUTURE],
    problematicOriginalStart: new Date(`${FUTURE}T18:00:00.000Z`),
    problematicOriginalEnd: new Date(`${FUTURE}T19:00:00.000Z`),
    phases: [],
    phaseId: null,
    estimatedTimeInMinutes: 60,
    ...partial,
  } as Task;
}

describe('ProblematicPlaceService', () => {
  let rows: Map<string, Task>;
  const matches = (row: Task, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => (row as never)[key] === value);
  const taskRepo = {
    findOne: jest.fn(async ({ where }) => {
      const row = [...rows.values()].find((candidate) => matches(candidate, where));
      return row ? { ...row } : null;
    }),
    findOneOrFail: jest.fn(async ({ where }) => {
      const row = [...rows.values()].find((candidate) => matches(candidate, where));
      if (!row) throw new Error('not found');
      return { ...row };
    }),
    save: jest.fn(async (row: Task) => {
      const id = row.id ?? 'copy-1';
      const saved = { ...row, id } as Task;
      rows.set(id, saved);
      return saved;
    }),
    create: jest.fn((row) => row),
  };
  const slotRepo = { find: jest.fn().mockResolvedValue([]), remove: jest.fn() };
  const pendingGoogleWrites = { syncTask: jest.fn().mockResolvedValue(undefined) };
  // Same contract as PlacementStepService.writeAndPlace: one transaction that
  // rolls back (here: restores the row snapshot) when `accept` refuses the plan.
  const placementStep = {
    place: jest.fn(),
    writeAndPlace: jest.fn(async (userId: string, write, accept = () => true) => {
      const snapshot = new Map([...rows].map(([id, row]) => [id, { ...row }]));
      const { taskId, opts } = await write({ tasks: taskRepo, slots: slotRepo });
      const plan = await placementStep.place(userId, taskId, opts);
      if (!accept(plan)) {
        rows = snapshot;
        return { plan, taskId, committed: false };
      }
      return { plan, taskId, committed: true };
    }),
  };
  const phasesService = {
    findAllForScheduling: jest.fn().mockResolvedValue([
      { id: 'evening', name: 'Evening' },
    ]),
  };
  const userSettingsService = {
    getSettings: jest.fn().mockResolvedValue({ timeZone: 'UTC' }),
  };
  let service: ProblematicPlaceService;

  const seatedAtStart = async () => ({
    outcome: 'seated',
    start: Date.parse(start),
    end: Date.parse(end),
    moves: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    rows = new Map();
    placementStep.place.mockImplementation(seatedAtStart);
    service = new ProblematicPlaceService(
      taskRepo as never,
      placementStep as never,
      phasesService as never,
      userSettingsService as never,
      pendingGoogleWrites as never,
    );
  });

  it('seats a parked one-off as a drag and keeps it flexible', async () => {
    rows.set('task-1', parkedTask());
    const out = await service.place('user-1', 'task-1', {
      start,
      end,
      phaseIds: ['evening'],
    });
    expect(out).toEqual({ taskId: 'task-1', start, end });
    expect(placementStep.place).toHaveBeenCalledWith('user-1', 'task-1', {
      preferredStart: new Date(start),
      durationMinutes: 60,
      commit: 'preferred',
      drag: true,
    });
    const saved = rows.get('task-1')!;
    expect(saved.eventType).toBe(TaskEventType.ADMIN);
    expect(saved.phaseId).toBe('evening');
  });

  it('PE-18 keeps the park untouched when the slot was taken meanwhile (rollback)', async () => {
    rows.set('task-1', parkedTask());
    placementStep.place.mockResolvedValue({
      outcome: 'problematic',
      reason: 'no_slot',
    });
    await expect(
      service.place('user-1', 'task-1', { start, end, phaseIds: ['evening'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const saved = rows.get('task-1')!;
    expect(saved.scheduleState).toBe(ScheduleState.PROBLEMATIC);
    expect(saved.problematicDay).toBe(FUTURE);
    expect(saved.phaseId).toBeNull();
  });

  it('moves one series day as a linked copy and skips that day in one write', async () => {
    rows.set(
      'task-1',
      parkedTask({
        isRecurring: true,
        problematicOccurrenceYmds: [FUTURE, '2099-01-16'],
      }),
    );
    const out = await service.place('user-1', 'task-1', {
      start,
      end,
      occurrenceYmd: FUTURE,
    });
    expect(out.taskId).toBe('copy-1');
    const copy = rows.get('copy-1')!;
    expect(copy.parentSeriesId).toBe('task-1');
    expect(copy.seriesGroupId).toBe('task-1');
    expect(copy.originalOccurrenceYmd).toBe(FUTURE);
    expect(copy.isRecurring).toBe(false);
    expect(copy.eventType).toBe(TaskEventType.ADMIN);
    const series = rows.get('task-1')!;
    expect(series.skippedOccurrenceYmds).toEqual([FUTURE]);
    expect(parkedDays(series)).toEqual(['2099-01-16']);
    expect(pendingGoogleWrites.syncTask).toHaveBeenCalledWith('user-1', 'task-1');
  });

  it('PE-24 a day of a fixed series moves as a fixed copy', async () => {
    rows.set(
      'task-1',
      parkedTask({ isRecurring: true, eventType: TaskEventType.FIXED }),
    );
    await service.place('user-1', 'task-1', { start, end, occurrenceYmd: FUTURE });
    expect(rows.get('copy-1')!.eventType).toBe(TaskEventType.FIXED);
  });

  it('PE-18 leaves no copy and no skip when the series day does not seat (rollback)', async () => {
    rows.set('task-1', parkedTask({ isRecurring: true }));
    placementStep.place.mockResolvedValue({
      outcome: 'problematic',
      reason: 'no_slot',
    });
    await expect(
      service.place('user-1', 'task-1', { start, end, occurrenceYmd: FUTURE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.has('copy-1')).toBe(false);
    expect(rows.get('task-1')!.skippedOccurrenceYmds ?? []).toEqual([]);
    expect(parkedDays(rows.get('task-1')!)).toEqual([FUTURE]);
    expect(pendingGoogleWrites.syncTask).not.toHaveBeenCalled();
  });

  it('PE-18 a retry reuses the copy it already made for that day', async () => {
    rows.set('task-1', parkedTask({ isRecurring: true }));
    rows.set('copy-1', {
      ...parkedTask({ id: 'copy-1', scheduleState: ScheduleState.NONE }),
      seriesGroupId: 'task-1',
      parentSeriesId: 'task-1',
      originalOccurrenceYmd: FUTURE,
    } as Task);
    taskRepo.save.mockClear();
    const out = await service.place('user-1', 'task-1', { start, end, occurrenceYmd: FUTURE });
    expect(out.taskId).toBe('copy-1');
    expect([...rows.values()].filter((row) => row.originalOccurrenceYmd === FUTURE)).toHaveLength(1);
  });

  it('a copy that merged back answers the day in the inbox', async () => {
    rows.set(
      'task-1',
      parkedTask({
        isRecurring: true,
        problematicOccurrenceYmds: [FUTURE, '2099-01-16'],
      }),
    );
    placementStep.place.mockImplementation(async () => ({
      ...(await seatedAtStart()),
      mergedIntoTaskId: 'task-1',
    }));
    const out = await service.place('user-1', 'task-1', {
      start,
      end,
      occurrenceYmd: FUTURE,
    });
    expect(out.taskId).toBe('task-1');
    expect(rows.get('task-1')!.problematicOccurrenceYmds).toEqual(['2099-01-16']);
  });

  it('the last answered day leaves the inbox', async () => {
    rows.set('task-1', parkedTask({ isRecurring: true }));
    await service.place('user-1', 'task-1', { start, end, occurrenceYmd: FUTURE });
    expect(rows.get('task-1')!.scheduleState).toBe(ScheduleState.NONE);
  });

  it('rejects a slot in the past and a task that is not parked', async () => {
    rows.set('task-1', parkedTask({ scheduleState: ScheduleState.NONE }));
    await expect(
      service.place('user-1', 'task-1', {
        start: '2000-01-01T10:00:00.000Z',
        end: '2000-01-01T11:00:00.000Z',
      }),
    ).rejects.toThrow('Pick a time that has not passed.');
    await expect(
      service.place('user-1', 'task-1', { start, end }),
    ).rejects.toThrow('This task is not in Problematic.');
  });
});

describe('autoSeatOptions', () => {
  const today = '2099-01-10';

  it('PE-24 a fixed copy only takes its own clock back, never another hole', () => {
    expect(
      autoSeatOptions(parkedTask({ eventType: TaskEventType.FIXED }), today),
    ).toEqual({
      preferredStart: new Date(`${FUTURE}T18:00:00.000Z`),
      commit: 'preferred',
      windowYmd: FUTURE,
    });
    expect(
      autoSeatOptions(
        parkedTask({ eventType: TaskEventType.FIXED, problematicOriginalStart: null }),
        today,
      ),
    ).toBeNull();
  });

  it('keeps a parked day on that day, nearest its old clock', () => {
    expect(autoSeatOptions(parkedTask(), today)).toEqual({
      searchHole: true,
      rawHole: true,
      windowYmd: FUTURE,
      preferredStart: new Date(`${FUTURE}T18:00:00.000Z`),
    });
  });

  it('leaves conflict parks, series masters, and past days alone', () => {
    expect(
      autoSeatOptions(parkedTask({ problematicReason: 'conflict' }), today),
    ).toBeNull();
    expect(
      autoSeatOptions(parkedTask({ problematicReason: 'preferred_on_fixed' }), today),
    ).toBeNull();
    expect(autoSeatOptions(parkedTask({ isRecurring: true }), today)).toBeNull();
    expect(autoSeatOptions(parkedTask(), '2099-02-01')).toBeNull();
  });

  it('a park with no day searches the whole horizon', () => {
    expect(
      autoSeatOptions(parkedTask({ problematicDay: null }), today),
    ).toEqual({ searchHole: true, rawHole: true });
  });
});

describe('parkedDays', () => {
  it('prefers the list and falls back to the single day', () => {
    expect(
      parkedDays({ problematicOccurrenceYmds: ['2099-01-02', '2099-01-01'], problematicDay: null }),
    ).toEqual(['2099-01-01', '2099-01-02']);
    expect(
      parkedDays({ problematicOccurrenceYmds: null, problematicDay: '2099-01-03' }),
    ).toEqual(['2099-01-03']);
  });
});
