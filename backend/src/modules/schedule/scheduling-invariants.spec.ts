/**
 * Domain invariants (scheduling refactor, Scope E3), checked after every step
 * of a deterministic pseudo-random sequence over all four combinations
 * (fixed/flexible × single/recurring). Real TasksService + PlacementStepService
 * on in-memory SQLite.
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, Task, TaskStatus } from '../tasks/entities/task.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

/** Small deterministic PRNG so a failure replays exactly. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('scheduling invariants', () => {
  let kit: PlacementKit;
  /** Tasks whose last placement returned a conflict sheet: they wait for the user, not lost. */
  const awaitingAnswer = new Set<string>();

  beforeEach(async () => {
    awaitingAnswer.clear();
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 4 });
  });

  afterEach(async () => {
    await kit.destroy();
  });

  async function assertInvariants(step: string) {
    const tasks = await kit.taskRepo.find();
    const slots = await kit.slotRepo.find();
    const byTask = new Map<string, typeof slots>();
    for (const row of slots) byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), row]);
    const fixedSlots = slots.filter(
      (row) => tasks.find((task) => task.id === row.taskId)?.eventType === TaskEventType.FIXED,
    );

    for (const task of tasks) {
      const rows = byTask.get(task.id) ?? [];
      const days = rows.map((row) => kit.ymdOf(row.scheduledStartTime));
      // 2. No occurrence is duplicated: at most one slot per task per civil day.
      expect({ step, task: task.name, dup: days.length !== new Set(days).size }).toEqual({
        step,
        task: task.name,
        dup: false,
      });
      // 1. No task is silently lost: an open one-off is seated, in an inbox, or
      //    waiting for the user on a conflict sheet (spec: no answer → Problematic).
      if (
        !awaitingAnswer.has(task.id) &&
        !task.isRecurring &&
        task.status === TaskStatus.TODO &&
        !task.isUnscheduled &&
        task.scheduleState === ScheduleState.NONE
      ) {
        expect({ step, task: task.name, seated: rows.length > 0 }).toEqual({
          step,
          task: task.name,
          seated: true,
        });
      }
      // 3. Fixed occurrences keep their clock: a fixed one-off sits on its own
      //    interval; every day of a fixed series sits on the series clock.
      if (task.eventType === TaskEventType.FIXED && task.scheduledStartTime) {
        const hm = kit.hmOf(task.scheduledStartTime);
        for (const row of rows) {
          expect({ step, task: task.name, hm: kit.hmOf(row.scheduledStartTime) }).toEqual({
            step,
            task: task.name,
            hm,
          });
        }
      }
      // 4. Flexible occurrences respect wake/sleep (08:00–23:00).
      if (task.eventType !== TaskEventType.FIXED && task.scheduleState !== ScheduleState.RESOLVED) {
        for (const row of rows) {
          const start = kit.hmOf(row.scheduledStartTime);
          const end = kit.hmOf(row.scheduledEndTime);
          expect({ step, task: task.name, inDay: start >= '08:00' && end <= '23:00' }).toEqual({
            step,
            task: task.name,
            inDay: true,
          });
        }
      }
      // 6. A day copy stays tied to its occurrence: that day is skipped on the series.
      if (!task.isRecurring && task.originalOccurrenceYmd && task.parentSeriesId) {
        const parent = tasks.find((row) => row.id === task.parentSeriesId);
        if (parent) {
          expect(parent.skippedOccurrenceYmds ?? []).toContain(task.originalOccurrenceYmd);
        }
      }
    }
    // 5. Anchors are protected: no flexible slot overlaps a fixed slot.
    for (const row of slots) {
      const owner = tasks.find((task) => task.id === row.taskId);
      if (!owner || owner.eventType === TaskEventType.FIXED) continue;
      if (owner.scheduleState === ScheduleState.RESOLVED) continue;
      const clash = fixedSlots.find(
        (fixed) =>
          new Date(fixed.scheduledStartTime) < new Date(row.scheduledEndTime) &&
          new Date(row.scheduledStartTime) < new Date(fixed.scheduledEndTime),
      );
      expect({ step, flexible: owner.name, clash: !!clash }).toEqual({
        step,
        flexible: owner.name,
        clash: false,
      });
    }
  }

  async function create(body: Record<string, unknown>) {
    const created = await kit.tasksService.create(kit.user.id, {
      timeZone: 'UTC',
      priority: 'medium',
      allowSplit: false,
      ...body,
    } as never);
    await kit.jobs.settle();
    const last = kit.jobs.completeMutationJob.mock.calls.at(-1) as unknown[] | undefined;
    const conflicts = (last?.[1] as { conflicts?: Array<{ taskId: string }> } | undefined)?.conflicts;
    if (conflicts?.some((conflict) => conflict.taskId === (created as Task).id)) {
      awaitingAnswer.add((created as Task).id);
    }
    return created as Task;
  }

  it.each([20261105, 7, 4242])('hold across creates, edits, skips and deletes of all four combinations (seed %i)', async (seed) => {
    const random = rng(seed);
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const day = () => pick(['2026-11-05', '2026-11-06', '2026-11-07']);
    const hour = () => pick(['09', '10', '11', '14', '15', '18']);

    const standup = await create({
      name: 'Standup (fixed series)',
      eventType: TaskEventType.FIXED,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-05', '10:30').toISOString(),
      estimatedTimeInMinutes: 30,
    });
    await assertInvariants('create fixed series');
    const gym = await create({
      name: 'Gym (flexible series)',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 60,
    });
    await assertInvariants('create flexible series over the fixed series clock');

    const created: Task[] = [standup, gym];
    for (let step = 0; step < 24; step += 1) {
      const action = pick(['fixed', 'flexible', 'flexible-pref', 'edit', 'skip', 'delete']);
      const label = `${step}:${action}`;
      if (action === 'fixed') {
        const d = day();
        const h = hour();
        created.push(
          await create({
            name: `Fixed ${step}`,
            eventType: TaskEventType.FIXED,
            scheduledStartTime: kit.at(d, `${h}:00`).toISOString(),
            scheduledEndTime: kit.at(d, `${h}:45`).toISOString(),
            estimatedTimeInMinutes: 45,
          }),
        );
      } else if (action === 'flexible') {
        created.push(
          await create({ name: `Flex ${step}`, eventType: TaskEventType.ADMIN, estimatedTimeInMinutes: 60 }),
        );
      } else if (action === 'flexible-pref') {
        created.push(
          await create({
            name: `Pref ${step}`,
            eventType: TaskEventType.ADMIN,
            scheduledStartTime: kit.at(day(), `${hour()}:00`).toISOString(),
            estimatedTimeInMinutes: 60,
          }),
        );
      } else if (action === 'edit') {
        const target = pick(created);
        const fresh = await kit.taskRepo.findOneBy({ id: target.id });
        if (!fresh || fresh.eventType === TaskEventType.FIXED) continue;
        await kit.tasksService
          .update(fresh.id, kit.user.id, {
            scheduledStartTime: kit.at(day(), `${hour()}:00`).toISOString(),
          } as never)
          .catch(() => undefined);
        await kit.jobs.settle();
      } else if (action === 'skip') {
        const rows = await kit.slotRepo.find({ where: { taskId: pick([standup.id, gym.id]) } });
        if (!rows.length) continue;
        await kit.tasksService
          .skipOccurrence(rows[0].taskId, kit.user.id, {
            occurrenceStart: new Date(rows[0].scheduledStartTime).toISOString(),
          })
          .catch(() => undefined);
      } else {
        const target = pick(created.slice(2));
        if (!target || !(await kit.taskRepo.findOneBy({ id: target.id }))) continue;
        await kit.tasksService.remove(target.id, kit.user.id);
      }
      await assertInvariants(label);
    }
  }, 60_000);
});
