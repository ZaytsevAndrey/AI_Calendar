import { matchPreset, presetPatch, recurrenceOptionsFor } from './constants';

describe('presetPatch', () => {
  it('turns on the unscheduled inbox flags and clears slot fields', () => {
    expect(presetPatch('unscheduled')).toMatchObject({
      isUnscheduled: true,
      isFixed: false,
      isRecurring: false,
      scheduledStartTime: '',
      scheduledEndTime: '',
      preferredStartTime: '',
      earliestStartTime: '',
    });
  });

  it('clears isUnscheduled when switching to flexible or fixed', () => {
    expect(presetPatch('flexible').isUnscheduled).toBe(false);
    expect(presetPatch('fixed').isUnscheduled).toBe(false);
    expect(presetPatch('recurring').isUnscheduled).toBe(false);
  });
});

describe('matchPreset', () => {
  it('prefers unscheduled even if other flags are set', () => {
    expect(
      matchPreset({
        isUnscheduled: true,
        isFixed: true,
        isRecurring: false,
        allowSplit: false,
        recurrencePattern: undefined,
      }),
    ).toBe('unscheduled');
  });

  it('matches a weekly series even when split is off', () => {
    expect(
      matchPreset({
        isUnscheduled: false,
        isFixed: false,
        isRecurring: true,
        allowSplit: false,
        recurrencePattern: 'WEEKLY',
      }),
    ).toBe('recurring');
  });

  it('matches flexible when the inbox flag is off', () => {
    expect(
      matchPreset({
        isUnscheduled: false,
        isFixed: false,
        isRecurring: false,
        allowSplit: true,
        recurrencePattern: undefined,
      }),
    ).toBe('flexible');
  });
});

describe('recurrenceOptionsFor', () => {
  it('offers one weekly choice to a new task', () => {
    expect(recurrenceOptionsFor().map((o) => o.value)).toEqual(['DAILY', 'BIWEEKLY', 'MONTHLY']);
  });

  it('keeps WEEKLY for a task that already has it', () => {
    expect(recurrenceOptionsFor('WEEKLY').map((o) => o.value)).toContain('WEEKLY');
  });
});
