import {
  civilDayStartEndIso,
  dateTimeLocalToIso,
  isoToDateTimeLocal,
  localDateTimeIso,
} from './ianaDateTime';

describe('ianaDateTime', () => {
  it('builds a Nicosia wall clock with a +03:00 offset', () => {
    expect(localDateTimeIso('2026-09-08', '00:00', 'Asia/Nicosia')).toBe(
      '2026-09-08T00:00:00+03:00',
    );
  });

  it('round-trips an instant through Settings TZ, not the host clock', () => {
    const iso = '2026-09-11T00:00:00+03:00';
    expect(isoToDateTimeLocal(iso, 'Asia/Nicosia')).toBe('2026-09-11T00:00');
    expect(dateTimeLocalToIso('2026-09-11T00:00', 'Asia/Nicosia')).toBe(
      '2026-09-11T00:00:00+03:00',
    );
  });

  it('treats a calendar day click as that civil date in Settings TZ', () => {
    expect(civilDayStartEndIso('2026-09-10', 'Asia/Nicosia')).toEqual({
      start: '2026-09-10T00:00:00+03:00',
      end: '2026-09-10T23:59:00+03:00',
    });
  });
});
