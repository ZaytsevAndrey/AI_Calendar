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
});
