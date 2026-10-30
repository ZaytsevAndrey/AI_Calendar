import { randomUUID } from 'crypto';
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
import { ScheduleJobService } from '../../src/modules/schedule/schedule-job.service';
import { ScheduleJob } from '../../src/modules/schedule/entities/schedule-job.entity';
import { ScheduledTask } from '../../src/modules/schedule/schedule.entity';
import { DisplayedEventMoveService } from '../../src/modules/schedule/displayed-event-move.service';
import { ProblematicPlaceService } from '../../src/modules/schedule/problematic-place.service';
import { OccurrenceEditService } from '../../src/modules/schedule/occurrence-edit.service';
import { GoogleSyncOutboxSubscriber } from '../../src/modules/google-calendar/google-sync-outbox.subscriber';

/**
 * In-memory SQLite with the real entities and a real PlacementStepService.
 * With `postgresUrl`: a throwaway Postgres database instead (dropped on destroy;
 * DATABASE_URL must point at Postgres too, for the timestamp column type).
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
  postgresUrl?: string;
  /** Register the Google outbox subscriber (queue rows written with each change). */
  outbox?: boolean;
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

  const entities = [join(__dirname, '..', '..', 'src', 'modules', '**', '*.entity.{ts,js}').replace(/\\/g, '/')];
  const subscribers = opts.outbox ? [GoogleSyncOutboxSubscriber] : [];
  let dropDatabase = async (): Promise<void> => undefined;
  let ds: DataSource;
  if (opts.postgresUrl) {
    const admin = await new DataSource({ type: 'postgres', url: opts.postgresUrl }).initialize();
    const name = `luefy_kit_${randomUUID().slice(0, 8)}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(opts.postgresUrl);
    target.pathname = `/${name}`;
    ds = new DataSource({ type: 'postgres', url: target.toString(), synchronize: true, entities, subscribers });
    dropDatabase = async () => {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.destroy();
    };
  } else {
    ds = new DataSource({ type: 'sqlite', database: ':memory:', synchronize: true, entities, subscribers });
  }
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
    enqueue: jest.fn(async () => undefined),
    discardPendingUpserts: jest.fn(async () => undefined),
    waitForInflight: jest.fn(async () => undefined),
    kickRows: jest.fn(async () => 0),
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

  // Real durable job queue on the real schedule_jobs table (stabilization A).
  // Methods are spied so tests can read the calls; `jobs.settle()` waits for
  // every job this process started.
  const jobService = new ScheduleJobService(
    ds.getRepository(ScheduleJob),
    taskRepo,
    slotRepo,
    {} as never,
  );
  jest.spyOn(jobService, 'beginMutationJob');
  jest.spyOn(jobService, 'completeMutationJob');
  jest.spyOn(jobService, 'failMutationJob');
  const jobs = Object.assign(jobService, {
    settle: () => jobService.drain(),
  }) as ScheduleJobService & {
    settle: () => Promise<void>;
    completeMutationJob: jest.Mock;
    failMutationJob: jest.Mock;
    beginMutationJob: jest.Mock;
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
    await dropDatabase();
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

  /** Real one-occurrence / this-and-following edit service. */
  const occurrenceEdit = new OccurrenceEditService(
    taskRepo,
    slotRepo,
    service,
    phasesStub as never,
    settingsStub as never,
    pendingGoogleWrites as never,
    jobs as never,
    moveService,
    tasksService,
  );

  // Nest calls these on boot; the kit builds services by hand.
  tasksService.onModuleInit();
  moveService.onModuleInit();

  return {
    ds,
    service,
    moveService,
    problematicPlace,
    occurrenceEdit,
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
