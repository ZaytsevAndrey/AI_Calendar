import {
  buildTaskPayload,
  formValuesFromCreatePayload,
  initialFormValues,
  windowSpansMultipleDays,
} from './buildPayload';
import { matchPreset, presetPatch } from './constants';
import type { TaskFormValues } from './schema';

const NICOSIA = 'Asia/Nicosia';

function flexible(overrides: Partial<TaskFormValues> = {}): TaskFormValues {
  return {
    name: 'Wash the car',
    description: '',
    isFixed: false,
    phaseId: '',
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    allowSplit: true,
    priority: 'medium',
    deadline: '',
    earliestStartTime: '',
    eligibleWeekDays: [],
    scheduledStartTime: '',
    scheduledEndTime: '',
    preferredStartTime: '',
    ...overrides,
  };
}

describe('buildTaskPayload', () => {
  it('encodes From/Until in Settings TZ, not the host clock', () => {
    const payload = buildTaskPayload(
      flexible({
        earliestStartTime: '2026-09-11T00:00',
        deadline: '2026-09-11T23:59',
      }),
      NICOSIA,
    );
    expect(payload.timeZone).toBe(NICOSIA);
    expect(payload.earliestStartTime).toBe('2026-09-11T00:00:00+03:00');
    expect(payload.deadline).toBe('2026-09-11T23:59:00+03:00');
  });

  it('sends empty phaseIds so edit can clear the phase', () => {
    const payload = buildTaskPayload(flexible(), NICOSIA);
    expect(payload.phaseIds).toEqual([]);
    expect(payload.phaseId).toBeUndefined();
  });

  it('keeps unscheduled tasks off the calendar payload', () => {
    const payload = buildTaskPayload(
      flexible({
        isUnscheduled: true,
        deadline: '2026-09-11T23:59',
        location: 'Home',
        googleColorId: '7',
      }),
      NICOSIA,
    );
    expect(payload.isUnscheduled).toBe(true);
    expect(payload.eventType).toBe('admin');
    expect(payload.scheduledStartTime).toBeNull();
    expect(payload.scheduledEndTime).toBeNull();
    expect(payload.earliestStartTime).toBeNull();
    expect(payload.deadline).toBeNull();
    expect(payload.location).toBe('Home');
    expect(payload.googleColorId).toBe('7');
    expect(payload.isRecurring).toBe(false);
    expect(payload.googleReminders).toEqual({ useDefault: true });
  });

  it('drops the phase on a fixed task and keeps the chosen status', () => {
    const payload = buildTaskPayload(
      flexible({
        isFixed: true,
        phaseId: 'phase-1',
        status: 'in_progress',
        scheduledStartTime: '2026-09-11T09:00',
        scheduledEndTime: '2026-09-11T10:00',
      }),
      NICOSIA,
    );
    expect(payload.phaseIds).toEqual([]);
    expect(payload.phaseId).toBeUndefined();
    expect(payload.status).toBe('in_progress');
  });

  it('drops a deadline on a fixed task', () => {
    const payload = buildTaskPayload(
      flexible({
        isFixed: true,
        deadline: '2026-09-11T23:59',
        scheduledStartTime: '2026-09-11T09:00',
        scheduledEndTime: '2026-09-11T10:00',
      }),
      NICOSIA,
    );
    expect(payload.eventType).toBe('fixed');
    expect(payload.deadline).toBeNull();
  });

  it('writes custom Google reminders when defaults are turned off', () => {
    const payload = buildTaskPayload(
      flexible({
        googleReminderUseDefault: false,
        googleReminderOverrides: [{ method: 'email', minutes: 30 }],
        googleVisibility: 'private',
        googleTransparency: 'transparent',
      }),
      NICOSIA,
    );
    expect(payload.googleReminders).toEqual({
      useDefault: false,
      overrides: [{ method: 'email', minutes: 30 }],
    });
    expect(payload.googleVisibility).toBe('private');
    expect(payload.googleTransparency).toBe('transparent');
  });

  it('sends null deadline so edit can clear Until', () => {
    const payload = buildTaskPayload(flexible(), NICOSIA);
    expect(payload.deadline).toBeNull();
  });

  it('places preferred start on the From day in Settings TZ', () => {
    const payload = buildTaskPayload(
      flexible({
        earliestStartTime: '2026-09-11T00:00',
        deadline: '2026-09-11T23:59',
        preferredStartTime: '09:00',
      }),
      NICOSIA,
    );
    expect(payload.scheduledStartTime).toBe('2026-09-11T09:00:00+03:00');
  });
});

describe('windowSpansMultipleDays', () => {
  it('compares civil dates on datetime-local strings', () => {
    expect(windowSpansMultipleDays('2026-09-11T00:00', '2026-09-11T23:59')).toBe(false);
    expect(windowSpansMultipleDays('2026-09-11T00:00', '2026-09-13T23:59')).toBe(true);
  });
});

describe('default task duration', () => {
  it('starts a new task at the settings duration', () => {
    const values = initialFormValues(undefined, undefined, NICOSIA, 45);
    expect(values.estimatedTimeInMinutes).toBe(45);
  });

  it('applies the settings duration when switching to flexible', () => {
    expect(presetPatch('flexible', 45).estimatedTimeInMinutes).toBe(45);
  });
});

describe('initialFormValues', () => {
  it('shows stored instants as Settings TZ wall clocks', () => {
    const values = initialFormValues(
      {
        id: 't1',
        name: 'Gym',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        allowSplit: true,
        priority: 'medium',
        status: 'todo',
        createdAt: '',
        updatedAt: '',
        earliestStartTime: '2026-09-10T21:00:00.000Z',
        deadline: '2026-09-11T20:59:00.000Z',
      },
      undefined,
      NICOSIA,
    );
    expect(values.earliestStartTime).toBe('2026-09-11T00:00');
    expect(values.deadline).toBe('2026-09-11T23:59');
  });

  it('loads unscheduled inbox fields and Google extras', () => {
    const values = initialFormValues(
      {
        id: 't1',
        name: 'Buy milk',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        allowSplit: true,
        priority: 'medium',
        status: 'todo',
        createdAt: '',
        updatedAt: '',
        isUnscheduled: true,
        deadline: '2026-09-11T20:59:00.000Z',
        location: 'Store',
        googleColorId: '4',
        googleVisibility: 'private',
        googleReminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
      },
      undefined,
      NICOSIA,
    );
    expect(values.isUnscheduled).toBe(true);
    expect(values.isFixed).toBe(false);
    expect(values.deadline).toBe('');
    expect(values.location).toBe('Store');
    expect(values.googleColorId).toBe('4');
    expect(values.googleVisibility).toBe('private');
    expect(values.googleReminderUseDefault).toBe(false);
    expect(values.googleReminderOverrides).toEqual([{ method: 'popup', minutes: 5 }]);
  });

  it('clears the inbox flag when opening a task to schedule it', () => {
    const values = initialFormValues(
      {
        id: 't1',
        name: 'Buy milk',
        estimatedTimeInMinutes: 45,
        isRecurring: false,
        allowSplit: true,
        priority: 'medium',
        status: 'todo',
        createdAt: '',
        updatedAt: '',
        isUnscheduled: true,
      },
      { scheduleIntent: true },
      NICOSIA,
    );
    expect(values.isUnscheduled).toBe(false);
    expect(values.estimatedTimeInMinutes).toBe(45);
    expect(values.allowSplit).toBe(true);
  });

  it('starts a blank create form in unscheduled mode when requested', () => {
    const values = initialFormValues(undefined, { unscheduled: true }, NICOSIA);
    expect(values.isUnscheduled).toBe(true);
    expect(values.name).toBe('');
    expect(values.googleReminderUseDefault).toBe(true);
  });

  it('opens a fixed task without a phase and with its status', () => {
    const values = initialFormValues(
      {
        id: 't1',
        name: 'Call',
        eventType: 'fixed',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        allowSplit: false,
        priority: 'medium',
        status: 'in_progress',
        phaseId: 'phase-1',
        createdAt: '',
        updatedAt: '',
      },
      undefined,
      NICOSIA,
    );
    expect(values.isFixed).toBe(true);
    expect(values.phaseId).toBe('');
    expect(values.status).toBe('in_progress');
  });

  it('opens a blank create in Flexible: a name is enough to capture a task', () => {
    const values = initialFormValues(undefined, undefined, NICOSIA);
    expect(values.isFixed).toBe(false);
    expect(values.isUnscheduled).toBe(false);
    expect(values.isRecurring).toBe(false);
    expect(values.allowSplit).toBe(true);
  });

  it('opens a civil-day window on the flexible tab', () => {
    const values = initialFormValues(
      undefined,
      {
        earliestStartTime: '2026-10-24T00:00:00+03:00',
        deadline: '2026-10-24T23:59:00+03:00',
      },
      NICOSIA,
    );
    expect(values.isFixed).toBe(false);
    expect(values.earliestStartTime).toBe('2026-10-24T00:00');
    expect(values.deadline).toBe('2026-10-24T23:59');
  });
});

describe('formValuesFromCreatePayload', () => {
  it('prefills a fixed task from a selected calendar range', () => {
    const values = formValuesFromCreatePayload(
      {
        name: '',
        eventType: 'fixed',
        allowSplit: false,
        isRecurring: false,
        estimatedTimeInMinutes: 90,
        scheduledStartTime: '2026-10-24T07:00:00.000Z',
        scheduledEndTime: '2026-10-24T08:30:00.000Z',
      },
      'UTC',
    );
    expect(values.isFixed).toBe(true);
    expect(values.isRecurring).toBe(false);
    expect(values.allowSplit).toBe(false);
    expect(values.name).toBe('');
    expect(values.scheduledStartTime).toBe('2026-10-24T07:00');
    expect(values.scheduledEndTime).toBe('2026-10-24T08:30');
    expect(values.estimatedTimeInMinutes).toBe(90);
  });
});

describe('edit keeps the seated slot', () => {
  const seated = {
    id: 't2',
    name: 'Wash the car',
    eventType: 'admin' as const,
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    allowSplit: true,
    priority: 'medium' as const,
    status: 'todo' as const,
    // Fri 16 Oct 2026, 14:00 in Nicosia.
    scheduledStartTime: '2026-10-16T11:00:00.000Z',
    scheduledEndTime: '2026-10-16T11:30:00.000Z',
    createdAt: '',
    updatedAt: '',
  };

  it('a rename sends the same start, not today at that clock', () => {
    const values = initialFormValues(seated, undefined, NICOSIA);
    const payload = buildTaskPayload({ ...values, name: 'Wash the bike' }, NICOSIA);
    expect(new Date(payload.scheduledStartTime!).toISOString()).toBe('2026-10-16T11:00:00.000Z');
    expect(new Date(payload.scheduledEndTime!).toISOString()).toBe('2026-10-16T11:30:00.000Z');
  });

  it('a new clock stays on the seated day', () => {
    const values = initialFormValues(seated, undefined, NICOSIA);
    const payload = buildTaskPayload({ ...values, preferredStartTime: '16:00' }, NICOSIA);
    expect(payload.scheduledStartTime).toBe('2026-10-16T16:00:00+03:00');
  });

  it('a window that no longer holds the seat moves the clock to the window', () => {
    const values = initialFormValues(seated, undefined, NICOSIA);
    const payload = buildTaskPayload(
      {
        ...values,
        earliestStartTime: '2026-10-20T00:00',
        deadline: '2026-10-21T23:59',
      },
      NICOSIA,
    );
    expect(payload.scheduledStartTime).toBe('2026-10-20T14:00:00+03:00');
  });
});

describe('fixed duration', () => {
  it('comes from the slot, not the stale form number', () => {
    const payload = buildTaskPayload(
      flexible({
        isFixed: true,
        estimatedTimeInMinutes: 30,
        scheduledStartTime: '2026-10-24T10:00',
        scheduledEndTime: '2026-10-24T12:00',
      }),
      NICOSIA,
    );
    expect(payload.estimatedTimeInMinutes).toBe(120);
  });
});

describe('fixed series', () => {
  const series = () =>
    flexible({
      isFixed: true,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [1],
      scheduledStartTime: '2026-11-02T10:00',
      scheduledEndTime: '2026-11-02T11:00',
      deadline: '2026-11-30T23:59',
    });

  it('keeps fixed, repeats, starts on the slot day and ends on Until', () => {
    const payload = buildTaskPayload(series(), NICOSIA);
    expect(payload).toMatchObject({
      eventType: 'fixed',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [1],
      earliestStartTime: '2026-11-02T00:00:00+02:00',
      deadline: '2026-11-30T23:59:00+02:00',
      estimatedTimeInMinutes: 60,
      phaseIds: [],
    });
    expect(payload.scheduledStartTime).toBe('2026-11-02T10:00:00+02:00');
  });

  it('a one-off fixed still drops the window', () => {
    const payload = buildTaskPayload({ ...series(), isRecurring: false }, NICOSIA);
    expect(payload.isRecurring).toBe(false);
    expect(payload.deadline).toBeNull();
    expect(payload.earliestStartTime).toBeNull();
  });

  it('opens on the Fixed tab with Repeat and Until', () => {
    const values = initialFormValues(
      {
        id: 's1',
        name: 'Standup',
        status: 'todo',
        eventType: 'fixed',
        estimatedTimeInMinutes: 60,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        recurrenceWeekDays: [1],
        allowSplit: false,
        priority: 'medium',
        scheduledStartTime: '2026-11-02T08:00:00.000Z',
        scheduledEndTime: '2026-11-02T09:00:00.000Z',
        deadline: '2026-11-30T21:59:00.000Z',
        createdAt: '',
        updatedAt: '',
      },
      undefined,
      NICOSIA,
    );
    expect(matchPreset(values as never)).toBe('fixed');
    expect(values.isRecurring).toBe(true);
    expect(values.deadline).toBe('2026-11-30T23:59');
  });
});
