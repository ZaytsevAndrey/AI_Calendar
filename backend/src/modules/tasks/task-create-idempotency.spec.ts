/**
 * Idempotent task creation on a real (SQLite) database: one Idempotency-Key
 * is one create operation. Content never decides what is a duplicate.
 */
import { GoneException, UnprocessableEntityException } from '@nestjs/common';
import { RequestIdempotency } from './entities/request-idempotency.entity';
import { createRequestHash, IDEMPOTENCY_RETENTION_MS } from './tasks.service';
import { User } from '../users/user.entity';
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

  it('AUD-024: a replay finds the create job even after many later edits of the task', async () => {
    const first = await create('form-1');
    await kit.jobs.settle();
    for (let i = 0; i < 11; i += 1) {
      await kit.tasksService.update(first.id, kit.user.id, { name: `Buy milk ${i}` } as never);
      await kit.jobs.settle();
    }

    const again = await create('form-1');

    expect(again.jobId).toBe(first.jobId);
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

  it('Place on top (resolved) writes its slot with the task and job, or not at all', async () => {
    const parked = await kit.addTask({
      name: 'Parked',
      scheduleState: 'problematic' as never,
      problematicOriginalStart: kit.at('2026-11-05', '10:00'),
      problematicOriginalEnd: kit.at('2026-11-05', '11:00'),
    });
    kit.jobs.beginMutationJob.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      kit.tasksService.update(parked.id, kit.user.id, { scheduleState: 'resolved' } as never),
    ).rejects.toThrow('disk full');
    expect(await kit.slotsOf(parked.id)).toEqual([]);
    expect((await kit.reload(parked.id)).scheduleState).toBe('problematic');

    await kit.tasksService.update(parked.id, kit.user.id, { scheduleState: 'resolved' } as never);
    await kit.jobs.settle();
    expect(await kit.slotsOf(parked.id)).toEqual(['2026-11-05 10:00-11:00']);
  });

  it('a race the lock cannot see (another instance) is caught by the unique index', async () => {
    // Another instance records the same key (with its task) between our replay
    // check and our insert: our transaction hits the unique index and rolls back.
    const runExclusive = kit.service.runExclusive.bind(kit.service);
    let otherId = '';
    jest.spyOn(kit.service, 'runExclusive').mockImplementationOnce(async (userId, run) => {
      const other = await kit.addTask({ name: 'Buy milk' });
      otherId = other.id;
      await kit.ds.getRepository(RequestIdempotency).insert({
        userId: kit.user.id,
        operation: 'task.create',
        key: 'race-1',
        requestHash: createRequestHash(body),
        resourceId: other.id,
      });
      return runExclusive(userId, run);
    });
    jest.spyOn(kit.tasksService as never, 'replayCreate' as never).mockResolvedValueOnce(null as never);

    const result = await create('race-1');

    expect(await count()).toBe(1);
    expect(result.id).toBe(otherId);
  });

  it('a replay after the task was deleted is Gone (410) and never creates it again', async () => {
    const first = await create('form-1');
    await kit.jobs.settle();
    await kit.tasksService.remove(first.id, kit.user.id);

    await expect(create('form-1')).rejects.toBeInstanceOf(GoneException);
    await expect(create('form-1')).rejects.toBeInstanceOf(GoneException);
    expect(await count()).toBe(0);
    // A new operation (new key) still creates.
    await create('form-2');
    await kit.jobs.settle();
    expect(await count()).toBe(1);
  });

  it('the same key with a different body is refused (422) and writes nothing', async () => {
    const first = await create('form-1');
    await kit.jobs.settle();
    await expect(
      kit.tasksService.create(kit.user.id, { name: 'Buy bread', estimatedTimeInMinutes: 30, timeZone: 'UTC' } as never, {
        requestKey: 'form-1',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(await count()).toBe(1);
    expect((await kit.reload(first.id)).name).toBe('Buy milk');
  });

  it('field order does not change the request identity', () => {
    expect(createRequestHash({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } })).toBe(
      createRequestHash({ b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }),
    );
    expect(createRequestHash({ a: 1 })).not.toBe(createRequestHash({ a: 2 }));
  });

  it('keys are remembered for the retention window, then forgotten', async () => {
    const first = await create('form-1');
    await kit.jobs.settle();
    // SQLite stamps createdAt with the real clock; pin it to the test clock.
    await kit.ds.getRepository(RequestIdempotency).update({ key: 'form-1' }, { createdAt: new Date() });
    jest.setSystemTime(Date.now() + IDEMPOTENCY_RETENTION_MS - 60_000);
    expect((await create('form-1')).id).toBe(first.id);
    // Age the record past the window.
    await kit.ds.getRepository(RequestIdempotency).update(
      { key: 'form-1' },
      { createdAt: new Date(Date.now() - IDEMPOTENCY_RETENTION_MS - 60_000) },
    );
    const later = await create('form-1');
    await kit.jobs.settle();
    expect(later.id).not.toBe(first.id);
    expect(await kit.ds.getRepository(RequestIdempotency).count()).toBe(1);
  });

  it('keys are per user', async () => {
    const other = await kit.ds.getRepository(User).save({ email: 'other@example.com', password: 'x' } as User);
    const mine = await create('shared-key');
    const theirs = await kit.tasksService.create(other.id, body, { requestKey: 'shared-key' });
    await kit.jobs.settle();
    expect(theirs.id).not.toBe(mine.id);
  });
});
