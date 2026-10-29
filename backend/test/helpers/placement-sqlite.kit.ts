import { Logger } from '@nestjs/common';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';
import { TaskEventType } from '../../src/modules/scheduling/event-type.enum';
import { Phase } from '../../src/modules/phases/entities/phase.entity';
import { ScheduleState, Task, TaskStatus } from '../../src/modules/tasks/entities/task.entity';
import { TasksService } from '../../src/modules/tasks/tasks.service';
import { UserSettings } from '../../src/modules/user-settings/entities/user-settings.entity';
import { User } from '../../src/modules/users/user.entity';
import { localDateTimeIso, localYmd } from '../../src/modules/voice/voice-local-date.util';
import { PlacementStepService } from '../../src/modules/schedule/placement-step.service';
import { ScheduledTask } from '../../src/modules/schedule/schedule.entity';
import { DisplayedEventMoveService } from '../../src/modules/schedule/displayed-event-move.service';
import { ProblematicPlaceService } from '../../src/modules/schedule/problematic-place.service';

/**
 * In-memory SQLite with the real entities and a real PlacementStepService.
 * Settings, Google writes, and external calendars are stubs.
 * The clock is frozen at `now`; timers stay real so SQLite I/O runs.
 */
export type PlacementKit = Awaited<ReturnType<typeof createPlacementKit>>;

export async function createPlacementKit(opts: {
  now: string;
  timeZone?: string;
  wakeTime?: string;
  sleepTime?: string;
  horizonDays?: number;
}) {
  jest.useFakeTimers({
    now: new Date(opts.now),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  Logger.overrideLogger(['error']);
  const timeZone = opts.timeZone ?? 'UTC';

  const ds = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    synchronize: true,
    entities: [join(__dirname, '..', '..', 'src', 'modules', '**', '*.entity.{ts,js}').replace(/\\/g, '/')],
  });
  await ds.initialize();

  const taskRepo: Repository<Task> = ds.getRepository(Task);
  const slotRepo: Repository<ScheduledTask> = ds.getRepository(ScheduledTask);
  const phaseRepo: Repository<Phase> = ds.getRepository(Phase);
  const user = await ds
    .getRepository(User)
    .save({ email: 'kit@example.com', password: 'x' } as User);

  const settings = {
    userId: user.id,
    timeZone,
    wakeTime: opts.wakeTime ?? '08:00',
    sleepTime: opts.sleepTime ?? '23:00',
    weekendWorkEnabled: true,
    googleCalendarLinked: false,
    recurringScheduleHorizonDays: opts.horizonDays ?? 14,
    fixedEventBufferMinutes: 0,
  };
  const pendingGoogleWrites = {
    syncTask: jest.fn(),
    syncTaskSoon: jest.fn(),
  };

  /** External calendars (Google / Microsoft) seen by placement. */
  const externalBusy = { listVisibleEvents: jest.fn().mockResolvedValue([]) };
  const service = new PlacementStepService(
    ds,
    taskRepo,
    slotRepo,
    { getSettings: jest.fn(async () => settings) } as never,
    {
      findAllForScheduling: (userId: string) =>
        phaseRepo.find({ where: { userId }, order: { name: 'ASC' } }),
    } as never,
    pendingGoogleWrites as never,
    externalBusy as never,
  );

  await ds.getRepository(UserSettings).save({ ...settings } as never);

  // Mutation jobs run in the background; `jobs.settle()` waits for all of them.
  const pendingJobs: Promise<void>[] = [];
  const jobDone = new Map<string, () => void>();
  let jobSeq = 0;
  const jobs = {
    beginMutationJob: jest.fn(async () => {
      const id = `job-${++jobSeq}`;
      pendingJobs.push(new Promise<void>((resolve) => jobDone.set(id, resolve)));
      return { id };
    }),
    setMutationStage: jest.fn(async () => undefined),
    completeMutationJob: jest.fn(async (id: string) => jobDone.get(id)?.()),
    failMutationJob: jest.fn(async (id: string) => jobDone.get(id)?.()),
    settle: () => Promise.all(pendingJobs),
  };
  const tasksService = new TasksService(
    taskRepo,
    phaseRepo,
    ds.getRepository(UserSettings),
    slotRepo,
    jobs as never,
    service,
    {} as never,
    pendingGoogleWrites as never,
  );

  /** Wall-clock instant in the kit time zone. */
  const at = (ymd: string, hm: string) => new Date(localDateTimeIso(ymd, hm, timeZone));
  const ymdOf = (date: Date) => localYmd(new Date(date).toISOString(), timeZone);
  const hmOf = (date: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(date));

  async function addPhase(partial: Partial<Phase> & Pick<Phase, 'startTime' | 'endTime'>) {
    return phaseRepo.save({
      name: 'Phase',
      color: '#000',
      type: 'time_phase',
      weekDays: null,
      userId: user.id,
      ...partial,
    } as Phase);
  }

  async function addTask(partial: Partial<Task>) {
    return taskRepo.save({
      name: 'Task',
      userId: user.id,
      eventType: TaskEventType.ADMIN,
      status: TaskStatus.TODO,
      scheduleState: ScheduleState.NONE,
      estimatedTimeInMinutes: 60,
      isRecurring: false,
      isUnscheduled: false,
      phaseId: null,
      ...partial,
    } as Task);
  }

  async function addSlot(taskId: string, start: Date, end: Date) {
    return slotRepo.save({
      taskId,
      scheduledStartTime: start,
      scheduledEndTime: end,
    } as ScheduledTask);
  }

  /** `YYYY-MM-DD HH:mm-HH:mm` rows for one task, sorted. */
  async function slotsOf(taskId: string): Promise<string[]> {
    const rows = await slotRepo.find({ where: { taskId } });
    return rows
      .map(
        (row) =>
          `${ymdOf(row.scheduledStartTime)} ${hmOf(row.scheduledStartTime)}-${hmOf(row.scheduledEndTime)}`,
      )
      .sort();
  }

  async function reload(taskId: string) {
    return taskRepo.findOneByOrFail({ id: taskId });
  }

  async function destroy() {
    await ds.destroy();
    jest.useRealTimers();
  }

  const settingsStub = { getSettings: async () => settings };
  const phasesStub = {
    findAllForScheduling: (userId: string) =>
      phaseRepo.find({ where: { userId }, order: { name: 'ASC' } }),
  };
  /** Real calendar drag service (Google patch is a stub that succeeds). */
  const moveService = new DisplayedEventMoveService(
    slotRepo,
    taskRepo,
    tasksService,
    { patchEventTimes: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    pendingGoogleWrites as never,
    service,
    settingsStub as never,
    phasesStub as never,
    jobs as never,
  );
  /** Real Problematic Move service. */
  const problematicPlace = new ProblematicPlaceService(
    taskRepo,
    service,
    phasesStub as never,
    settingsStub as never,
    pendingGoogleWrites as never,
  );

  return {
    ds,
    service,
    moveService,
    problematicPlace,
    tasksService,
    jobs,
    taskRepo,
    slotRepo,
    user,
    settings,
    pendingGoogleWrites,
    externalBusy,
    at,
    ymdOf,
    hmOf,
    addPhase,
    addTask,
    addSlot,
    slotsOf,
    reload,
    destroy,
  };
}
