import {
  resolveVoiceCommand,
  sniffCommandIntent,
} from './voice-command.resolve';
import type { VoiceCommandDraft, VoiceCommandSlot, VoiceCommandTask } from './voice-command.types';

const NOW = '2026-09-22T10:00:00.000Z';
const ZONE = 'Europe/Kyiv';

function task(partial: Partial<VoiceCommandTask> & Pick<VoiceCommandTask, 'id' | 'name'>): VoiceCommandTask {
  return {
    status: 'todo',
    isRecurring: false,
    isUnscheduled: false,
    isFixedExternal: false,
    eventType: 'admin',
    googleEventId: null,
    googleEventCalendarId: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    ...partial,
  };
}

function slot(partial: Partial<VoiceCommandSlot> & Pick<VoiceCommandSlot, 'id' | 'taskId'>): VoiceCommandSlot {
  return {
    startIso: '2026-09-22T09:00:00.000Z',
    endIso: '2026-09-22T11:00:00.000Z',
    googleEventId: 'evt-1',
    googleEventCalendarId: 'cal-1',
    synthetic: false,
    ...partial,
  };
}

function draft(partial: Partial<VoiceCommandDraft> & Pick<VoiceCommandDraft, 'intent'>): VoiceCommandDraft {
  return {
    target: 'named',
    taskName: null,
    spokenStart: null,
    spokenEnd: null,
    ...partial,
  };
}

describe('sniffCommandIntent', () => {
  it('leaves a new task alone', () => {
    expect(sniffCommandIntent('add dentist tomorrow')).toBeNull();
    expect(sniffCommandIntent('buy milk')).toBeNull();
  });

  it('recognizes leading command verbs', () => {
    expect(sniffCommandIntent('skip dentist')).toBe('skip');
    expect(sniffCommandIntent('перенеси стоматолога на завтра')).toBe('reschedule');
    expect(sniffCommandIntent('зробив звіт')).toBe('complete');
    expect(sniffCommandIntent('done')).toBe('complete');
  });
});

describe('resolveVoiceCommand', () => {
  const dentist = task({ id: 't1', name: 'Dentist' });
  const gym = task({ id: 't2', name: 'Gym', isRecurring: true, googleEventId: 'series-1' });

  it('completes a named non-recurring task', () => {
    const result = resolveVoiceCommand({
      draft: draft({ intent: 'complete', taskName: 'Dentist' }),
      transcript: 'done with dentist',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks: [dentist],
      slots: [],
    });
    expect(result).toMatchObject({
      type: 'command',
      command: { kind: 'complete', taskId: 't1' },
    });
  });

  it('skips today when a recurring task is marked done', () => {
    const result = resolveVoiceCommand({
      draft: draft({ intent: 'complete', taskName: 'Gym' }),
      transcript: 'закінчив gym',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks: [gym],
      slots: [slot({ id: 's2', taskId: 't2', googleEventId: 'series-1' })],
    });
    expect(result).toMatchObject({
      type: 'command',
      command: { kind: 'skip', taskId: 't2', occurrenceStart: '2026-09-22T09:00:00.000Z' },
    });
  });

  it('uses the block in progress when no name is spoken', () => {
    const result = resolveVoiceCommand({
      draft: draft({ intent: 'skip', target: 'current' }),
      transcript: 'skip this',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks: [dentist],
      slots: [slot({ id: 's1', taskId: 't1' })],
    });
    expect(result).toMatchObject({
      type: 'command',
      command: { kind: 'skip', taskId: 't1' },
    });
  });

  it('refuses when nothing is in progress', () => {
    const result = resolveVoiceCommand({
      draft: draft({ intent: 'complete', target: 'current' }),
      transcript: 'done',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks: [dentist],
      slots: [],
    });
    expect(result).toEqual({
      type: 'command',
      command: { kind: 'refuse', message: 'Nothing is in progress.' },
    });
  });

  it('asks once when two names match, then stops', () => {
    const tasks = [task({ id: 'a', name: 'Dentist' }), task({ id: 'b', name: 'Dentist follow-up' })];
    const first = resolveVoiceCommand({
      draft: draft({ intent: 'complete', taskName: 'dent' }),
      transcript: 'done dentist',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks,
      slots: [],
    });
    expect(first).toMatchObject({ type: 'clarify' });
    const second = resolveVoiceCommand({
      draft: draft({ intent: 'complete', taskName: 'dent' }),
      transcript: 'done dentist',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: true,
      tasks,
      slots: [],
    });
    expect(second).toMatchObject({ type: 'command', command: { kind: 'refuse' } });
  });

  it('moves an open slot to the spoken clock', () => {
    const result = resolveVoiceCommand({
      draft: draft({ intent: 'reschedule', taskName: 'Dentist' }),
      transcript: 'move dentist to tomorrow at 15:00',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks: [dentist],
      slots: [slot({ id: 's1', taskId: 't1' })],
    });
    expect(result.type).toBe('command');
    if (result.type !== 'command' || result.command.kind !== 'move') {
      throw new Error('expected a move');
    }
    expect(result.command.originalStart).toBe('2026-09-22T09:00:00.000Z');
    expect(result.command.start).toContain('2026-09-23T15:00:00');
    expect(result.command.googleEventId).toBe('evt-1');
  });

  it('updates the window when the task has no open slot', () => {
    const result = resolveVoiceCommand({
      draft: draft({ intent: 'reschedule', taskName: 'Dentist' }),
      transcript: 'move dentist to tomorrow',
      timeZone: ZONE,
      nowIso: NOW,
      alreadyClarified: false,
      tasks: [dentist],
      slots: [],
    });
    expect(result).toMatchObject({
      type: 'command',
      command: {
        kind: 'window',
        taskId: 't1',
        earliestStartTime: expect.stringContaining('2026-09-23T00:00:00'),
        deadline: expect.stringContaining('2026-09-23T23:59:00'),
      },
    });
  });
});
