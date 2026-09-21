import {
  buildTaskPayload,
  initialFormValues,
  windowSpansMultipleDays,
} from './buildPayload';
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
    expect(payload.deadline).toBe('2026-09-11T23:59:00+03:00');
    expect(payload.location).toBe('Home');
    expect(payload.googleColorId).toBe('7');
    expect(payload.isRecurring).toBe(false);
    expect(payload.googleReminders).toEqual({ useDefault: true });
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
    expect(values.deadline).toBe('2026-09-11T23:59');
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
});
