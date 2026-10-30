/**
 * PE-27: placement reads only what it needs. Real services on in-memory SQLite.
 */
import { ScheduleState } from '../tasks/entities/task.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('placement load (PE-27)', () => {
  let kit: PlacementKit;

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.destroy();
  });

  it('seatOpenHoles reads external calendars once per pass, not once per parked task', async () => {
    for (const name of ['A', 'B', 'C']) {
      await kit.addTask({
        name,
        scheduleState: ScheduleState.PROBLEMATIC,
        problematicReason: 'no_slot',
        problematicDay: '2026-11-06',
        problematicOriginalStart: kit.at('2026-11-06', '10:00'),
      });
    }
    kit.externalBusy.listVisibleEvents.mockClear();

    await kit.service.seatOpenHoles(kit.user.id);

    expect(kit.externalBusy.listVisibleEvents).toHaveBeenCalledTimes(1);
    // All three still seated, each in its own hour on its day (same result as before).
    const seated = (await kit.taskRepo.find()).filter(
      (task) => task.scheduleState === ScheduleState.NONE,
    );
    expect(seated).toHaveLength(3);
    const rows = (await kit.slotRepo.find()).map((row) => kit.hmOf(row.scheduledStartTime)).sort();
    expect(new Set(rows).size).toBe(3);
  });

  it('a drag loads only the dragged block and its task, not the user history', async () => {
    const target = await kit.addTask({ name: 'Target' });
    const slot = await kit.addSlot(target.id, kit.at('2026-11-06', '10:00'), kit.at('2026-11-06', '11:00'));
    await kit.slotRepo.update({ id: slot.id }, { googleEventId: 'evt-target' });
    for (let day = 1; day <= 20; day += 1) {
      const old = await kit.addTask({ name: `Old ${day}` });
      const ymd = `2026-10-${String(day).padStart(2, '0')}`;
      await kit.addSlot(old.id, kit.at(ymd, '10:00'), kit.at(ymd, '11:00'));
    }
    const loaded: number[] = [];
    const realFind = kit.taskRepo.find.bind(kit.taskRepo);
    jest.spyOn(kit.taskRepo, 'find').mockImplementation(async (...args) => {
      const rows = await realFind(...(args as [never]));
      loaded.push(rows.length);
      return rows;
    });
    const findAll = jest.spyOn(kit.tasksService, 'findAll');

    const out = await kit.moveService.move(kit.user.id, {
      googleEventId: 'evt-target',
      originalStart: kit.at('2026-11-06', '10:00').toISOString(),
      originalEnd: kit.at('2026-11-06', '11:00').toISOString(),
      start: kit.at('2026-11-06', '14:00').toISOString(),
      end: kit.at('2026-11-06', '15:00').toISOString(),
    } as never);

    await kit.jobs.settle();
    expect(out.kind).toBe('slot');
    expect(await kit.slotsOf(target.id)).toEqual(['2026-11-06 14:00-15:00']);
    expect(findAll).not.toHaveBeenCalled();
    // The candidate-task lookup returned the one task behind the dragged block.
    expect(loaded[0]).toBe(1);
  });
});
