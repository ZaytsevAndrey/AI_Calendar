import type { VoiceWriteIntent } from 'api/voice.api';
import { eventsApi } from 'api/eventsApi';
import { notifyScheduleJobSettled } from 'modules/schedule/conflictChoiceBus';
import { executeVoiceIntents, isDefiniteFailure } from './executeVoiceIntents';

const remove = (taskId: string): VoiceWriteIntent => ({
  type: 'command',
  summary: taskId,
  command: { kind: 'delete', taskId, taskName: taskId, summary: taskId },
});

function deps(deleteTask: (id: string) => Promise<unknown>) {
  return {
    updateTask: () => ({ unwrap: async () => undefined }),
    skipOccurrence: () => ({ unwrap: async () => undefined }),
    deleteTask: (id: string) => ({ unwrap: () => deleteTask(id) }),
    dispatch: () => undefined,
    onCreate: async () => undefined,
  };
}

describe('executeVoiceIntents report', () => {
  it('marks a client-error rejection as definite and later rows as skipped', async () => {
    const { report } = await executeVoiceIntents([remove('a'), remove('b'), remove('c')], deps(async (id) => {
      if (id === 'b') throw { status: 404, data: {} };
    }));
    expect(report.results).toEqual([
      { summary: 'a', status: 'applied' },
      { summary: 'b', status: 'error', definite: true },
      { summary: 'c', status: 'skipped' },
    ]);
  });

  it('leaves a lost connection or server error uncertain', async () => {
    const { report } = await executeVoiceIntents([remove('a')], deps(async () => {
      throw new Error('Network Error');
    }));
    expect(report.results).toEqual([{ summary: 'a', status: 'error' }]);
  });

  it('deletes a provider event through its own provider', async () => {
    const initiate = jest.spyOn(eventsApi.endpoints.deleteEvent, 'initiate');
    const unwrap = jest.fn(async () => undefined);
    const { report } = await executeVoiceIntents(
      [{
        type: 'command',
        summary: 'Dentist',
        command: { kind: 'delete_event', taskId: 'ext:microsoft:ev', taskName: 'Dentist', summary: 'Dentist', eventId: 'ev', calendarId: 'cal-ms', provider: 'microsoft' },
      }],
      {
        ...deps(async () => undefined),
        dispatch: () => ({ unwrap }) as never,
      },
    );
    expect(report.results).toEqual([{ summary: 'Dentist', status: 'applied' }]);
    expect(unwrap).toHaveBeenCalledTimes(1);
    expect(initiate).toHaveBeenCalledWith({ eventId: 'ev', calendarId: 'cal-ms', provider: 'microsoft' });
    initiate.mockRestore();
  });

  it('renames a provider event with only its title', async () => {
    const initiate = jest.spyOn(eventsApi.endpoints.updateEvent, 'initiate');
    const unwrap = jest.fn(async () => undefined);
    const { report } = await executeVoiceIntents(
      [{
        type: 'command',
        summary: 'Rename',
        command: { kind: 'rename_event', taskId: 'ext:google:ev', taskName: 'Dentist', summary: 'Rename', eventId: 'ev', calendarId: 'primary', provider: 'google', title: 'Dentist checkup' },
      }],
      {
        ...deps(async () => undefined),
        dispatch: () => ({ unwrap }) as never,
      },
    );
    expect(report.results).toEqual([{ summary: 'Rename', status: 'applied' }]);
    expect(initiate).toHaveBeenCalledWith({ eventId: 'ev', eventData: { summary: 'Dentist checkup' }, calendarId: 'primary', provider: 'google' });
    initiate.mockRestore();
  });

  // VC-14: two creates with one name in one request are two tasks. Nothing on the client may fold them
  // by name; a retried identical request is covered by the Idempotency-Key on POST /tasks.
  it('hands every create to onCreate, including two with the same name and different clocks', async () => {
    // A create waits for the placement job of that task to settle, as it does in the app.
    const onCreate = jest.fn(async (_task: { scheduledStartTime?: string | null }) => {
      notifyScheduleJobSettled();
    });
    const create = (start: string): VoiceWriteIntent => ({
      type: 'create',
      summary: `Call mom ${start}`,
      task: {
        name: 'Call mom',
        eventType: 'fixed',
        estimatedTimeInMinutes: 15,
        allowSplit: false,
        priority: 'medium',
        scheduledStartTime: start,
        scheduledEndTime: start,
      },
    });
    const { report } = await executeVoiceIntents(
      [create('2026-10-19T07:00:00.000Z'), create('2026-10-19T12:00:00.000Z')],
      { ...deps(async () => undefined), onCreate },
    );
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate.mock.calls.map(([task]) => task.scheduledStartTime)).toEqual([
      '2026-10-19T07:00:00.000Z',
      '2026-10-19T12:00:00.000Z',
    ]);
    expect(report.results.map((row) => row.status)).toEqual(['applied', 'applied']);
  });

  it('classifies statuses', () => {
    expect(isDefiniteFailure({ status: 400 })).toBe(true);
    expect(isDefiniteFailure({ response: { status: 409 } })).toBe(true);
    expect(isDefiniteFailure({ status: 408 })).toBe(false);
    expect(isDefiniteFailure({ status: 429 })).toBe(false);
    expect(isDefiniteFailure({ status: 503 })).toBe(false);
    expect(isDefiniteFailure(new Error('x'))).toBe(false);
  });
});
