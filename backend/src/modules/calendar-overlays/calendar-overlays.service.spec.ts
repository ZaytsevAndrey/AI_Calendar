import { CalendarOverlaysService } from './calendar-overlays.service';
import { TaskEventType } from '../scheduling/event-type.enum';

describe('CalendarOverlaysService', () => {
  const overlayRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'ov-1', ...row })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const tasksService = {
    create: jest.fn().mockResolvedValue({ id: 'task-1' }),
  };
  const googleCalendarService = {
    deleteEvent: jest.fn().mockResolvedValue(undefined),
  };
  const microsoftCalendar = {
    deleteEvent: jest.fn().mockResolvedValue(undefined),
  };
  const appleCalendar = {
    deleteEvent: jest.fn().mockResolvedValue(undefined),
  };

  const service = new CalendarOverlaysService(
    overlayRepo as never,
    tasksService as never,
    googleCalendarService as never,
    microsoftCalendar as never,
    appleCalendar as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an overlay on first setMode', async () => {
    overlayRepo.findOne.mockResolvedValue(null);
    const row = await service.setMode('u1', 'google', 'ev-1', {
      schedulingMode: 'flexible',
      calendarId: 'primary',
    });
    expect(row.schedulingMode).toBe('flexible');
    expect(overlayRepo.save).toHaveBeenCalled();
  });

  it('unschedules by deleting Google event and creating Unscheduled task', async () => {
    const result = await service.unschedule('u1', 'google', 'ev-9', {
      calendarId: 'cal',
      title: 'Doctor',
    });
    expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(
      'u1',
      'ev-9',
      'cal',
    );
    expect(tasksService.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        name: 'Doctor',
        isUnscheduled: true,
        eventType: TaskEventType.ADMIN,
      }),
    );
    expect(result.taskId).toBe('task-1');
  });

  it('unschedules Apple events via CalDAV delete', async () => {
    const opaqueId = Buffer.from(
      'https://caldav.icloud.com/cal/x.ics',
      'utf8',
    ).toString('base64url');
    const result = await service.unschedule('u1', 'apple', opaqueId, {
      calendarId: 'https://caldav.icloud.com/cal/',
      title: 'Home chore',
    });
    expect(appleCalendar.deleteEvent).toHaveBeenCalledWith(
      'u1',
      opaqueId,
      'https://caldav.icloud.com/cal/',
    );
    expect(result.taskId).toBe('task-1');
  });
});
