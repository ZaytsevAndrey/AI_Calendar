/**
 * Idempotent task creation on a real (SQLite) database: one Idempotency-Key
 * is one create operation. Content never decides what is a duplicate.
 */
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('task create idempotency', () => {
  let kit: PlacementKit;

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.destroy();
  });

  const body = { name: 'Buy milk', estimatedTimeInMinutes: 30, timeZone: 'UTC' } as never;
  const create = (key?: string) => kit.tasksService.create(kit.user.id, body, { requestKey: key ?? null });
  const count = () => kit.taskRepo.count({ where: { userId: kit.user.id } });

  it('a replay of the same request returns the first task and its job', async () => {
    const first = await create('form-1');
    await kit.jobs.settle();
    const again = await create('form-1');
    await kit.jobs.settle();

    expect(again.id).toBe(first.id);
    expect(again.jobId).toBe(first.jobId);
    expect(await count()).toBe(1);
    expect(await kit.slotsOf(first.id)).toHaveLength(1);
  });

  it('identical content with different keys, or no key, is two tasks', async () => {
    const a = await create('form-1');
    const b = await create('form-2');
    const c = await create();
    const d = await create();
    await kit.jobs.settle();

    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
    expect(await count()).toBe(4);
  });

  it('concurrent identical requests with one key make one task', async () => {
    const results = await Promise.all([create('tap-1'), create('tap-1'), create('tap-1')]);
    await kit.jobs.settle();

    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await count()).toBe(1);
  });

  it('a race the lock cannot see (another instance) is caught by the unique index', async () => {
    // Another instance inserts the same key between our replay check and our insert.
    const runExclusive = kit.service.runExclusive.bind(kit.service);
    jest.spyOn(kit.service, 'runExclusive').mockImplementationOnce(async (userId, run) => {
      await kit.addTask({ name: 'Buy milk', createRequestKey: 'race-1' });
      return runExclusive(userId, run);
    });
    jest.spyOn(kit.tasksService as never, 'replayCreate' as never).mockResolvedValueOnce(null as never);

    const result = await create('race-1');

    expect(await count()).toBe(1);
    const stored = await kit.taskRepo.findOneByOrFail({ createRequestKey: 'race-1' });
    expect(result.id).toBe(stored.id);
  });
});
