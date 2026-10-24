import {
  TIMED_CARD_HALF_HOUR_PX,
  TIMED_CARD_OPEN_PX,
  timedCardBox,
  timedCardClass,
} from './timedCardLayout';

describe('timedCardBox', () => {
  it('keeps a half-hour card at its own height and scales the stack down', () => {
    expect(TIMED_CARD_HALF_HOUR_PX).toBe(24);
    expect(timedCardBox(30)).toEqual({
      mode: 'fit',
      heightPx: TIMED_CARD_HALF_HOUR_PX,
      openPx: TIMED_CARD_OPEN_PX,
    });
    expect(timedCardClass('fit')).toBe('calendar-chip--fit');
  });

  it('uses the full stack once the card is tall enough for it', () => {
    expect(timedCardBox(60)).toEqual({ mode: 'stacked', heightPx: 48, openPx: TIMED_CARD_OPEN_PX });
    expect(timedCardClass('stacked')).toBe('');
  });

  it('treats anything under half an hour as a micro card at its own height', () => {
    expect(timedCardBox(10)).toEqual({ mode: 'micro', heightPx: 8, openPx: TIMED_CARD_OPEN_PX });
    expect(timedCardBox(15)).toEqual({ mode: 'micro', heightPx: 12, openPx: TIMED_CARD_OPEN_PX });
    expect(timedCardBox(29).mode).toBe('micro');
    expect(timedCardClass('micro')).toBe('calendar-chip--micro');
  });

  it('does not grow a missing duration into a half-hour card', () => {
    expect(timedCardBox(0)).toEqual({ mode: 'micro', heightPx: 0, openPx: TIMED_CARD_OPEN_PX });
    expect(timedCardBox(Number.NaN)).toEqual({ mode: 'micro', heightPx: 0, openPx: TIMED_CARD_OPEN_PX });
  });
});
