import { switchPreset } from './presetSwitch';
import type { TaskFormValues } from './schema';

function values(overrides: Partial<TaskFormValues>): TaskFormValues {
  return {
    name: 'Dentist',
    isFixed: false,
    isUnscheduled: false,
    isRecurring: false,
    estimatedTimeInMinutes: 30,
    earliestStartTime: '',
    deadline: '',
    preferredStartTime: '',
    scheduledStartTime: '',
    scheduledEndTime: '',
    ...overrides,
  };
}

describe('switchPreset', () => {
  it('flexible day → fixed preselects that day', () => {
    const next = switchPreset(
      values({ earliestStartTime: '2026-10-24T00:00', deadline: '2026-10-24T23:59' }),
      'fixed',
    );
    expect(next.fixedDay).toBe('2026-10-24');
    expect(next.patch.earliestStartTime).toBe('');
  });

  it('flexible day with a preferred clock → fixed slot of that length', () => {
    const next = switchPreset(
      values({
        earliestStartTime: '2026-10-24T00:00',
        deadline: '2026-10-24T23:59',
        preferredStartTime: '23:30',
        estimatedTimeInMinutes: 60,
      }),
      'fixed',
    );
    expect(next.patch.scheduledStartTime).toBe('2026-10-24T23:30');
    expect(next.patch.scheduledEndTime).toBe('2026-10-25T00:30');
  });

  it('fixed slot → flexible window, clock and duration', () => {
    const next = switchPreset(
      values({
        isFixed: true,
        scheduledStartTime: '2026-10-24T10:00',
        scheduledEndTime: '2026-10-24T11:30',
      }),
      'flexible',
    );
    expect(next.patch).toMatchObject({
      isFixed: false,
      earliestStartTime: '2026-10-24T00:00',
      deadline: '2026-10-24T23:59',
      preferredStartTime: '10:00',
      estimatedTimeInMinutes: 90,
      scheduledStartTime: '',
    });
  });

  it('fixed series slot → flexible starts the series on the slot day and keeps Until', () => {
    const next = switchPreset(
      values({
        isFixed: true,
        isRecurring: true,
        recurrencePattern: 'DAILY',
        recurrenceWeekDays: [1],
        scheduledStartTime: '2026-10-24T10:00',
        scheduledEndTime: '2026-10-24T11:00',
        deadline: '2026-12-31T23:59',
      }),
      'flexible',
    );
    expect(next.patch.earliestStartTime).toBe('2026-10-24T00:00');
    expect(next.patch.deadline).toBe('2026-12-31T23:59');
  });

  it('keeps a typed duration when switching back to flexible', () => {
    const next = switchPreset(values({ estimatedTimeInMinutes: 75 }), 'flexible', 30);
    expect(next.patch.estimatedTimeInMinutes).toBe(75);
  });
});

describe('switchPreset keeps recurrence (scheduling mode and repeat are independent)', () => {
  it('fixed series → flexible keeps the repeat rule', () => {
    const before = values({
      isFixed: true,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [1, 3, 5],
      scheduledStartTime: '2026-10-26T10:00',
      scheduledEndTime: '2026-10-26T10:30',
    });
    const after = { ...before, ...switchPreset(before, 'flexible').patch };
    expect(after.isRecurring).toBe(true);
    expect(after.recurrencePattern).toBe('DAILY');
    expect(after.recurrenceWeekDays).toEqual([1, 3, 5]);
    expect(after.isFixed).toBe(false);
  });

  it('flexible monthly series → fixed keeps monthly', () => {
    const before = values({
      isRecurring: true,
      recurrencePattern: 'MONTHLY',
      recurrenceWeekDays: [],
      earliestStartTime: '2026-10-26T00:00',
      preferredStartTime: '09:00',
    });
    const after = { ...before, ...switchPreset(before, 'fixed').patch };
    expect(after.isRecurring).toBe(true);
    expect(after.recurrencePattern).toBe('MONTHLY');
    expect(after.isFixed).toBe(true);
  });

  it('later drops recurrence (the inbox cannot hold a series)', () => {
    const next = switchPreset(
      values({ isRecurring: true, recurrencePattern: 'DAILY', recurrenceWeekDays: [1] }),
      'unscheduled',
    );
    expect(next.patch.isRecurring).toBe(false);
    expect(next.patch.isUnscheduled).toBe(true);
  });
});
