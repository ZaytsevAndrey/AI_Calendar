import { AccountDeletionService } from './account-deletion.service';
import { ApiError } from '../common/types/errors';

describe('AccountDeletionService', () => {
  const user = {
    id: 'u1',
    email: 'person@example.com',
    googleAccessToken: null as string | null,
    googleRefreshToken: null as string | null,
  };

  let usersRepo: { findOne: jest.Mock };
  let tasksRepo: { find: jest.Mock };
  let scheduledRepo: { createQueryBuilder: jest.Mock };
  let habitsRepo: { find: jest.Mock };
  let google: { deleteEvent: jest.Mock; deleteAppCalendar: jest.Mock };
  let dataSource: {
    options: { type: string };
    query: jest.Mock;
    getRepository: jest.Mock;
    transaction: jest.Mock;
  };
  let service: AccountDeletionService;

  beforeEach(() => {
    usersRepo = {
      findOne: jest.fn().mockResolvedValue({ ...user }),
    };
    tasksRepo = { find: jest.fn().mockResolvedValue([]) };
    scheduledRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    habitsRepo = { find: jest.fn().mockResolvedValue([]) };
    google = {
      deleteEvent: jest.fn().mockResolvedValue({ success: true }),
      deleteAppCalendar: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      options: { type: 'sqlite' },
      query: jest.fn().mockResolvedValue(undefined),
      // Day reminders read for the Google purge.
      getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([]) })),
      transaction: jest.fn(async (fn) => {
        const manager = {
          delete: jest.fn().mockResolvedValue(undefined),
          update: jest.fn().mockResolvedValue(undefined),
          find: jest.fn().mockResolvedValue([]),
          query: jest.fn().mockResolvedValue(undefined),
          getRepository: jest.fn((entity: { name: string }) => ({
            metadata: { tableName: entity.name.toLowerCase(), manyToManyRelations: [] },
          })),
        };
        await fn(manager);
        return manager;
      }),
    };
    service = new AccountDeletionService(
      usersRepo as never,
      tasksRepo as never,
      scheduledRepo as never,
      habitsRepo as never,
      google as never,
      dataSource as never,
    );
  });

  it('rejects a wrong confirmation phrase without touching data', async () => {
    await expect(service.deleteAccount('u1', 'nope')).rejects.toMatchObject({
      code: 'ACCOUNT_DELETE_CONFIRMATION_INVALID',
    } satisfies Partial<ApiError>);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(google.deleteAppCalendar).not.toHaveBeenCalled();
  });

  it('accepts DELETE and wipes local data when Google is disconnected', async () => {
    await service.deleteAccount('u1', 'DELETE');
    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect(google.deleteAppCalendar).not.toHaveBeenCalled();
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('accepts email case-insensitively', async () => {
    await service.deleteAccount('u1', 'Person@Example.com');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Google cleanup throws', async () => {
    usersRepo.findOne.mockResolvedValue({
      ...user,
      googleAccessToken: 'tok',
    });
    tasksRepo.find.mockResolvedValue([
      {
        id: 't1',
        googleEventId: 'g1',
        googleEventCalendarId: 'cal',
      },
    ]);
    google.deleteEvent.mockRejectedValue(new Error('quota'));

    await expect(service.deleteAccount('u1', 'DELETE')).rejects.toMatchObject({
      code: 'ACCOUNT_DELETE_CALENDAR_FAILED',
    } satisfies Partial<ApiError>);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('deletes Google events and the app calendar before the local wipe', async () => {
    usersRepo.findOne.mockResolvedValue({
      ...user,
      googleAccessToken: 'tok',
    });
    tasksRepo.find.mockResolvedValue([
      {
        id: 't1',
        googleEventId: 'g1',
        googleEventCalendarId: 'cal',
      },
    ]);
    habitsRepo.find.mockResolvedValue([
      { googleEventId: 'h1', googleEventCalendarId: 'cal' },
    ]);

    await service.deleteAccount('u1', 'DELETE');

    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'g1', 'cal');
    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'h1', 'cal');
    expect(google.deleteAppCalendar).toHaveBeenCalledWith('u1');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});
