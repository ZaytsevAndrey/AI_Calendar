import { matchPreset, presetPatch } from './constants';

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
