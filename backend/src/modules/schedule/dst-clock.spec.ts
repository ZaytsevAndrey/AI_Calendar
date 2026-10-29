/**
 * Wall clock → instant on DST switch days (scheduling uses localDateTimeIso
 * for every series day and window edge).
 */
import { localDateTimeIso } from '../voice/voice-local-date.util';
import { seriesDayClockHm } from './series-group.util';

const instant = (ymd: string, hm: string, zone: string) => new Date(localDateTimeIso(ymd, hm, zone)).toISOString();

describe('localDateTimeIso on DST switch days', () => {
  it('uses the offset in effect at that clock, not at noon', () => {
    // New York springs forward at 02:00 on 14 Mar 2027 (-05 → -04).
    expect(instant('2027-03-14', '01:30', 'America/New_York')).toBe('2027-03-14T06:30:00.000Z');
    expect(instant('2027-03-14', '03:30', 'America/New_York')).toBe('2027-03-14T07:30:00.000Z');
    // Kyiv falls back at 04:00 on 25 Oct 2026 (+03 → +02).
    expect(instant('2026-10-25', '02:00', 'Europe/Kyiv')).toBe('2026-10-24T23:00:00.000Z');
    expect(instant('2026-10-25', '05:00', 'Europe/Kyiv')).toBe('2026-10-25T03:00:00.000Z');
  });

  it('moves a skipped clock forward by the gap, and takes a repeated clock’s first occurrence', () => {
    expect(instant('2027-03-14', '02:30', 'America/New_York')).toBe('2027-03-14T07:30:00.000Z'); // 03:30 EDT
    expect(instant('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z'); // first 01:30 (EDT)
    expect(instant('2026-10-25', '03:30', 'Europe/Kyiv')).toBe('2026-10-25T00:30:00.000Z'); // first 03:30 (EEST)
  });

  it('is unchanged on ordinary days and in zones without DST', () => {
    expect(instant('2026-11-05', '10:00', 'UTC')).toBe('2026-11-05T10:00:00.000Z');
    expect(instant('2026-11-05', '10:00', 'Asia/Kolkata')).toBe('2026-11-05T04:30:00.000Z');
    expect(instant('2026-07-01', '09:15', 'Europe/Kyiv')).toBe('2026-07-01T06:15:00.000Z');
  });
});

describe('seriesDayClockHm', () => {
  it('counts the shifted start of a skipped clock as the series clock', () => {
    const shifted = Date.parse('2027-03-14T07:30:00.000Z'); // 03:30 EDT
    expect(seriesDayClockHm(shifted, 'America/New_York', '02:30')).toBe('02:30');
    // A real 03:30 series is still 03:30, and another clock stays itself.
    expect(seriesDayClockHm(shifted, 'America/New_York', '03:30')).toBe('03:30');
    expect(seriesDayClockHm(Date.parse('2027-03-14T13:00:00.000Z'), 'America/New_York', '02:30')).toBe('09:00');
  });
});
