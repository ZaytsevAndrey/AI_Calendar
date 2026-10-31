/**
 * VB-01: the client executor applies each structured command through the Scheduling API it maps to.
 * The server never writes; whatever these mappers drop is lost, so each field the preview promised is checked.
 */
import type { VoiceCommandAction, VoiceWriteIntent } from 'api/voice.api';
import { ScheduleApi } from 'api/schedule.api';
import apiCall from 'modules/common/utils/apiCall';
import { executeVoiceCommand } from './executeVoiceCommand';
import { executeVoiceIntents } from './executeVoiceIntents';
import { notifyScheduleJobSettled } from 'modules/schedule/conflictChoiceBus';

jest.mock('modules/common/utils/apiCall', () => ({ __esModule: true, default: jest.fn(async () => ({})) }));
jest.mock('modules/schedule/taskMutationProgress', () => ({
  startTaskMutationProgress: () => ({ setStage: jest.fn(), finish: jest.fn(), fail: jest.fn(), retarget: jest.fn() }),
}));
jest.mock('utils/toast', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }));

const apiCallMock = apiCall as unknown as jest.Mock;

function deps() {
  const updateTask = jest.fn((_arg: unknown) => ({ unwrap: async () => undefined }));
  const skipOccurrence = jest.fn((_arg: unknown) => ({ unwrap: async () => undefined }));
  const deleteTask = jest.fn((_arg: unknown) => ({ unwrap: async () => undefined }));
  const dispatch = jest.fn();
  return { updateTask, skipOccurrence, deleteTask, dispatch };
}

const base = { taskId: 't1', taskName: 'Report', summary: 'Report' };

describe('executeVoiceCommand — task patches', () => {
  it('forwards a scheduling patch of a Later task, including isUnscheduled false (VC-02)', async () => {
    const d = deps();
    await executeVoiceCommand(
      { kind: 'update', ...base, patch: { isUnscheduled: false, scheduledStartTime: '2026-10-22T12:00:00.000Z' } },
      d,
    );
    expect(d.updateTask).toHaveBeenCalledWith({ id: 't1', body: { isUnscheduled: false, scheduledStartTime: '2026-10-22T12:00:00.000Z' } });
  });

  it('forwards a window patch with isUnscheduled false (VC-02)', async () => {
    const d = deps();
    await executeVoiceCommand(
      { kind: 'update', ...base, patch: { isUnscheduled: false, earliestStartTime: '2026-10-22T04:00:00.000Z', deadline: '2026-10-22T20:00:00.000Z' } },
      d,
    );
    expect(d.updateTask.mock.calls[0][0]).toEqual({ id: 't1', body: { isUnscheduled: false, earliestStartTime: '2026-10-22T04:00:00.000Z', deadline: '2026-10-22T20:00:00.000Z' } });
  });

  it('clears notes with description null instead of dropping it (VC-10)', async () => {
    const d = deps();
    await executeVoiceCommand({ kind: 'update', ...base, patch: { description: null } }, d);
    expect(d.updateTask.mock.calls[0][0]).toEqual({ id: 't1', body: { description: null } });
  });

  it('sends a rename, priority, status and duration as one patch', async () => {
    const d = deps();
    await executeVoiceCommand({ kind: 'update', ...base, patch: { name: 'Draft', priority: 'high', status: 'completed', estimatedTimeInMinutes: 45 } }, d);
    expect(d.updateTask.mock.calls[0][0]).toEqual({ id: 't1', body: { name: 'Draft', priority: 'high', status: 'completed', estimatedTimeInMinutes: 45 } });
  });
});

describe('executeVoiceCommand — moves', () => {
  afterEach(() => jest.restoreAllMocks());

  it('moves an app slot by its slot id when it has no calendar event (VC-03)', async () => {
    const move = jest.spyOn(ScheduleApi, 'moveDisplayedEvent').mockResolvedValue({ jobId: null } as never);
    const d = deps();
    await executeVoiceCommand({
      kind: 'move', ...base, slotId: 'slot-1', googleEventId: null, calendarId: null, recurringEventId: null,
      originalStart: '2026-10-21T07:00:00.000Z', originalEnd: '2026-10-21T07:15:00.000Z', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:15:00.000Z',
    }, d);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0][0]).toMatchObject({ slotId: 'slot-1', googleEventId: '', originalStart: '2026-10-21T07:00:00.000Z', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:15:00.000Z' });
    expect(move.mock.calls[0][0]).not.toHaveProperty('seriesScope', expect.anything());
  });

  it('moves a calendar-backed task by its event id, with the series scope', async () => {
    const move = jest.spyOn(ScheduleApi, 'moveDisplayedEvent').mockResolvedValue({ jobId: null } as never);
    const d = deps();
    await executeVoiceCommand({
      kind: 'move', ...base, slotId: 'slot-2', googleEventId: 'g1', calendarId: 'primary', recurringEventId: 'm1',
      originalStart: '2026-10-21T15:00:00.000Z', originalEnd: '2026-10-21T16:00:00.000Z', start: '2026-10-21T16:00:00.000Z', end: '2026-10-21T17:00:00.000Z', seriesScope: 'occurrence',
    }, d);
    expect(move.mock.calls[0][0]).toMatchObject({ slotId: 'slot-2', googleEventId: 'g1', calendarId: 'primary', recurringEventId: 'm1', seriesScope: 'occurrence' });
  });

  it('rethrows a refused move so the run stops', async () => {
    jest.spyOn(ScheduleApi, 'moveDisplayedEvent').mockRejectedValue({ status: 400, data: { message: 'Recurring tasks can only be moved within the same day.' } });
    await expect(executeVoiceCommand({
      kind: 'move', ...base, googleEventId: 'g1', calendarId: null, recurringEventId: null,
      originalStart: '2026-10-21T15:00:00.000Z', originalEnd: '2026-10-21T16:00:00.000Z', start: '2026-10-22T16:00:00.000Z', end: '2026-10-22T17:00:00.000Z',
    }, deps())).rejects.toMatchObject({ status: 400 });
  });
});

describe('executeVoiceCommand — occurrences and reminders', () => {
  beforeEach(() => apiCallMock.mockClear());

  it('skips an occurrence with its start and, when present, its event ids', async () => {
    const d = deps();
    await executeVoiceCommand({ kind: 'skip', ...base, occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: null, googleEventCalendarId: null }, d);
    expect(d.skipOccurrence).toHaveBeenCalledWith({ id: 't1', body: { occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: undefined, googleEventCalendarId: undefined } });
  });

  it('ends a series from an occurrence through the end-series endpoint', async () => {
    const d = deps();
    await executeVoiceCommand({ kind: 'end_series', ...base, occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: 'g1', googleEventCalendarId: 'primary' }, d);
    expect(apiCallMock).toHaveBeenCalledWith({
      url: '/tasks/t1/end-series-from', method: 'POST', data: { occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: 'g1', googleEventCalendarId: 'primary' },
    });
  });

  it('creates, updates, resolves and deletes a reminder with every field', async () => {
    const d = deps();
    const fields = { dueYmd: '2026-11-01', notificationTime: '18:30', description: 'rent', recurrencePattern: 'MONTHLY' as const, recurrenceWeekDays: null };
    await executeVoiceCommand({ kind: 'remind_create', name: 'Pay rent', summary: 'r', ...fields }, d);
    await executeVoiceCommand({ kind: 'remind_update', reminderId: 'r1', name: 'Pay rent', summary: 'r', ...fields } as VoiceCommandAction, d);
    await executeVoiceCommand({ kind: 'remind_resolve', reminderId: 'r1', summary: 'r' } as VoiceCommandAction, d);
    await executeVoiceCommand({ kind: 'remind_delete', reminderId: 'r1', summary: 'r' } as VoiceCommandAction, d);
    const body = { name: 'Pay rent', ...fields };
    expect(apiCallMock.mock.calls.map((call) => call[0])).toEqual([
      { url: '/day-reminders', method: 'POST', data: body },
      { url: '/day-reminders/r1', method: 'PATCH', data: body },
      { url: '/day-reminders/r1/resolve', method: 'POST' },
      { url: '/day-reminders/r1', method: 'DELETE' },
    ]);
  });
});

describe('executeVoiceIntents — stop on the first error', () => {
  it('runs a create, then stops at the refused patch and skips the rest', async () => {
    // A create waits for a conflict sheet until the schedule job settles; the test settles it at once.
    const onCreate = jest.fn(async () => { notifyScheduleJobSettled(); });
    const d = deps();
    d.updateTask.mockImplementation(() => ({ unwrap: async () => { throw { status: 400, data: {} }; } }));
    const intents: VoiceWriteIntent[] = [
      { type: 'create', summary: 'new', task: { name: 'New', eventType: 'admin', estimatedTimeInMinutes: 30, isRecurring: false, allowSplit: false, priority: 'medium', isUnscheduled: true } },
      { type: 'command', summary: 'patch', command: { kind: 'update', ...base, patch: { name: 'X' } } },
      { type: 'command', summary: 'delete', command: { kind: 'delete', ...base } },
    ];
    const { report } = await executeVoiceIntents(intents, { ...d, onCreate });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(d.deleteTask).not.toHaveBeenCalled();
    expect(report.results.map((row) => row.status)).toEqual(['applied', 'error', 'skipped']);
    expect(report.results[1].definite).toBe(true);
  });
});
