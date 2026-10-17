import { parseVEvent, patchVEventIcs } from './apple-ics.util';

const SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-apple-1
SUMMARY:Team sync
DESCRIPTION:Notes here
LOCATION:Office
DTSTART:20260401T100000Z
DTEND:20260401T110000Z
END:VEVENT
END:VCALENDAR`;

describe('apple-ics.util', () => {
  it('parses a timed VEVENT', () => {
    const parsed = parseVEvent(SAMPLE);
    expect(parsed).toMatchObject({
      uid: 'evt-apple-1',
      summary: 'Team sync',
      description: 'Notes here',
      location: 'Office',
      start: { dateTime: '2026-04-01T10:00:00.000Z' },
      end: { dateTime: '2026-04-01T11:00:00.000Z' },
    });
  });

  it('patches start/end and summary', () => {
    const next = patchVEventIcs(SAMPLE, {
      summary: 'Retimed',
      startIso: '2026-04-01T12:00:00.000Z',
      endIso: '2026-04-01T13:00:00.000Z',
    });
    const parsed = parseVEvent(next);
    expect(parsed?.summary).toBe('Retimed');
    expect(parsed?.start?.dateTime).toBe('2026-04-01T12:00:00.000Z');
    expect(parsed?.end?.dateTime).toBe('2026-04-01T13:00:00.000Z');
  });

  it('parses all-day VALUE=DATE', () => {
    const ics = `BEGIN:VEVENT
UID:day-1
SUMMARY:Holiday
DTSTART;VALUE=DATE:20260402
DTEND;VALUE=DATE:20260403
END:VEVENT`;
    expect(parseVEvent(ics)).toMatchObject({
      uid: 'day-1',
      start: { date: '2026-04-02' },
      end: { date: '2026-04-03' },
    });
  });
});
