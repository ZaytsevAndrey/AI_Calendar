import { ScheduleService } from './schedule.service';
import { ScheduledTask } from './schedule.entity';

describe('ScheduleService.clearSchedule', () => {
  const userId = 'user-1';
  const endedRow = {
    googleEventId: 'keep-master',
    googleEventCalendarId: 'app-cal',
    scheduledStartTime: new Date('2026-04-20T09:00:00.000Z'),
    scheduledEndTime: new Date('2026-04-20T10:00:00.000Z'),
  } as ScheduledTask;
  const openRow = {
    googleEventId: 'future-1',
    googleEventCalendarId: 'app-cal',
    scheduledStartTime: new Date('2026-04-20T15:00:00.000Z'),
    scheduledEndTime: new Date('2026-04-20T16:00:00.000Z'),
  } as ScheduledTask;

  it('removes only still-open auto slots and asks Google wipe to keep ended series', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));

    let lastEndFilter: 'ended' | 'open' | null = null;
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((clause: string) => {
        if (clause.includes('scheduledEndTime <=')) lastEndFilter = 'ended';
        if (clause.includes('scheduledEndTime >')) lastEndFilter = 'open';
        return qb;
      }),
      getMany: jest.fn(async () =>
        lastEndFilter === 'ended' ? [endedRow] : [openRow],
      ),
    };
    const scheduledTaskRepository = {
      createQueryBuilder: jest.fn(() => qb),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const wipeAppCalendarEventsInRange = jest.fn().mockResolvedValue(1);
    const service = new ScheduleService(
      scheduledTaskRepository as never,
      {} as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          recurringScheduleHorizonDays: 30,
          timeZone: 'UTC',
        }),
      } as never,
      { wipeAppCalendarEventsInRange } as never,
    );

    const result = await service.clearSchedule(userId);

    expect(scheduledTaskRepository.remove).toHaveBeenCalledWith([openRow]);
    expect(wipeAppCalendarEventsInRange).toHaveBeenCalledTimes(1);
    const [, start, , opts] = wipeAppCalendarEventsInRange.mock.calls[0];
    expect(start.toISOString()).toBe('2026-04-20T12:00:00.000Z');
    expect(opts.keepEventIds.has('keep-master')).toBe(true);
    expect(opts.keepEventIds.has('future-1')).toBe(false);
    expect(opts.untilByEventId.get('keep-master')?.toISOString()).toBe(
      '2026-04-20T09:00:00.000Z',
    );
    expect(result.deleted).toBe(1);

    jest.useRealTimers();
  });
});
