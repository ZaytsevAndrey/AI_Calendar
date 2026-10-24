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

  it('parses people, a link, an alarm, and a private class', () => {
    const ics = `BEGIN:VEVENT
UID:full-1
SUMMARY:Family
DESCRIPTION:Bring the key
LOCATION:Home
URL:https://facetime.apple.com/join#sample
DTSTART:20261024T140000Z
DTEND:20261024T153000Z
STATUS:TENTATIVE
CLASS:PRIVATE
PRIORITY:1
CATEGORIES:Family,Errand
COMMENT:Park on the street
RRULE:FREQ=WEEKLY;BYDAY=SA
ORGANIZER;CN=Me:mailto:me@icloud.com
ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:me@icloud.com
ATTENDEE;CN=Kim;PARTSTAT=DECLINED;ROLE=OPT-PARTICIPANT:mailto:kim@example.com
ATTACH;FILENAME=list.txt:https://example.com/list.txt
X-APPLE-STRUCTURED-LOCATION;X-TITLE=Home;X-APPLE-ADDRESS="12 Garden Lane":geo:50,30
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
END:VALARM
END:VEVENT`;
    const parsed = parseVEvent(ics);
    expect(parsed?.url).toContain('facetime.apple.com');
    expect(parsed?.status).toBe('tentative');
    expect(parsed?.visibility).toBe('private');
    expect(parsed?.priority).toBe(1);
    expect(parsed?.categories).toEqual(['Family', 'Errand']);
    expect(parsed?.comment).toBe('Park on the street');
    expect(parsed?.recurrenceText).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(parsed?.organizer?.email).toBe('me@icloud.com');
    expect(parsed?.attendees?.[1]).toMatchObject({
      displayName: 'Kim',
      responseStatus: 'declined',
      optional: true,
    });
    expect(parsed?.attachments?.[0]).toEqual({
      label: 'list.txt',
      url: 'https://example.com/list.txt',
    });
    expect(parsed?.structuredLocation).toBe('Home');
    expect(parsed?.alarmMinutes).toEqual([30]);
    expect(parsed?.recurringEventId).toBeUndefined();
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
