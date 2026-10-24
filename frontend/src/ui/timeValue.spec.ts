import { formatTimeValue, minuteOptions, parseTimeValue } from './timeValue';

describe('parseTimeValue', () => {
  it('reads HH:mm and ignores trailing seconds', () => {
    expect(parseTimeValue('09:05')).toEqual({ hours: 9, minutes: 5 });
    expect(parseTimeValue('09:05:00')).toEqual({ hours: 9, minutes: 5 });
  });

  it('rejects empty and out-of-range values', () => {
    expect(parseTimeValue('')).toBeNull();
    expect(parseTimeValue(undefined)).toBeNull();
    expect(parseTimeValue('24:00')).toBeNull();
    expect(parseTimeValue('12:60')).toBeNull();
  });
});

describe('formatTimeValue', () => {
  it('pads hours and minutes', () => {
    expect(formatTimeValue(7, 5)).toBe('07:05');
  });
});

describe('minuteOptions', () => {
  it('lists the step and keeps a current minute that is off the step', () => {
    expect(minuteOptions(15, null)).toEqual([0, 15, 30, 45]);
    expect(minuteOptions(15, 7)).toEqual([0, 7, 15, 30, 45]);
  });

  it('treats a bad step as one minute', () => {
    expect(minuteOptions(0, null)).toHaveLength(60);
    expect(minuteOptions(Number.NaN, null)).toHaveLength(60);
  });
});
