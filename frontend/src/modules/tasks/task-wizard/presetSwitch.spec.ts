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

  it('fixed slot → recurring starts the series there without an end', () => {
    const next = switchPreset(
      values({
        isFixed: true,
        scheduledStartTime: '2026-10-24T10:00',
        scheduledEndTime: '2026-10-24T11:00',
      }),
      'recurring',
    );
    expect(next.patch.earliestStartTime).toBe('2026-10-24T00:00');
    expect(next.patch.deadline).toBe('');
  });

  it('keeps a typed duration between flexible and recurring', () => {
    const next = switchPreset(values({ estimatedTimeInMinutes: 75 }), 'recurring', 30);
    expect(next.patch.estimatedTimeInMinutes).toBe(75);
  });
});
