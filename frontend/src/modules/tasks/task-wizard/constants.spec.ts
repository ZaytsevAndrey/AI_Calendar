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
  });

  it('flexible and fixed leave the repeat rule alone (repeat is not a mode)', () => {
    for (const id of ['flexible', 'fixed'] as const) {
      const patch = presetPatch(id);
      expect('isRecurring' in patch).toBe(false);
      expect('recurrencePattern' in patch).toBe(false);
      expect('recurrenceWeekDays' in patch).toBe(false);
    }
  });
});

describe('matchPreset', () => {
  it('prefers unscheduled even if other flags are set', () => {
    expect(matchPreset({ isUnscheduled: true, isFixed: true })).toBe('unscheduled');
  });

  it('a repeating task is still flexible or fixed: repeat is not a mode', () => {
    expect(matchPreset({ isUnscheduled: false, isFixed: false })).toBe('flexible');
    expect(matchPreset({ isUnscheduled: false, isFixed: true })).toBe('fixed');
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
