import { GoogleCalendarEvent } from '../../api/google-calendar.api';
import {
  chipLabel,
  eventsForDay,
  eventsForHourSlot,
  eventsQueryRange,
  eventsVisibleInView,
  formatEventListDate,
  formatEventListTime,
  formatEventTime,
  getDaysInView,
  gridEventsForDay,
  periodLabel,
  shiftPeriod,
  startOfWeekMonday,
  visibleGoogleEvents,
  visibleRangeYmd,
  wakingHourSlots,
} from './calendarView';

function localDate(year: number, monthIndex: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

function timedEvent(
  id: string,
  summary: string,
  start: Date,
  end: Date,
  extra: Partial<GoogleCalendarEvent> = {},
): GoogleCalendarEvent {
  return {
    id,
    summary,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    status: 'confirmed',
    ...extra,
  };
}

function allDayEvent(id: string, summary: string, ymd: string): GoogleCalendarEvent {
  return {
    id,
    summary,
    start: { date: ymd },
    end: { date: ymd },
    status: 'confirmed',
  };
}

/** Wednesday 9 Sep 2026, a full week of mixed events. */
const focusDay = localDate(2026, 8, 9, 12, 0);
const standup = timedEvent(
  'standup',
  'Standup',
  localDate(2026, 8, 9, 9, 0),
  localDate(2026, 8, 9, 9, 30),
);
const lunch = timedEvent(
  'lunch',
  'Lunch',
  localDate(2026, 8, 9, 12, 0),
  localDate(2026, 8, 9, 13, 0),
);
const review = timedEvent(
  'review',
  'Review',
  localDate(2026, 8, 10, 14, 15),
  localDate(2026, 8, 10, 15, 0),
);
const planning = timedEvent(
  'planning',
  'Planning',
  localDate(2026, 8, 7, 10, 0),
  localDate(2026, 8, 7, 11, 0),
);
const fridayOff = allDayEvent('friday-off', 'Friday off', '2026-09-11');
const cancelled = timedEvent(
  'cancelled',
  'Cancelled slot',
  localDate(2026, 8, 9, 16, 0),
  localDate(2026, 8, 9, 16, 30),
  { status: 'cancelled' },
);
const lateNight = timedEvent(
  'late',
  'Late note',
  localDate(2026, 8, 9, 23, 30),
  localDate(2026, 8, 9, 23, 50),
);
const previousSunday = timedEvent(
  'prev-sun',
  'Previous Sunday',
  localDate(2026, 8, 6, 9, 0),
  localDate(2026, 8, 6, 10, 0),
);
const nextMonth = timedEvent(
  'oct',
  'October kickoff',
  localDate(2026, 9, 1, 9, 0),
  localDate(2026, 9, 1, 10, 0),
);

const catalog = [
  standup,
  lunch,
  review,
  planning,
  fridayOff,
  cancelled,
  lateNight,
  previousSunday,
  nextMonth,
];

const displayEvents = visibleGoogleEvents(catalog);

function ids(events: GoogleCalendarEvent[]): string[] {
  return events.map((event) => event.id).sort();
}

function ymd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

describe('visibleGoogleEvents', () => {
  it('drops cancelled events and keeps the rest', () => {
    expect(ids(displayEvents)).toEqual(
      ids(catalog.filter((event) => event.status !== 'cancelled')),
    );
    expect(ids(displayEvents)).not.toContain('cancelled');
  });
});

describe('getDaysInView', () => {
  it('day view is the selected local date', () => {
    const days = getDaysInView('day', focusDay);
    expect(days).toHaveLength(1);
    expect(ymd(days[0])).toBe('2026-09-09');
  });

  it('week view is Monday–Sunday around the selected date', () => {
    const days = getDaysInView('week', focusDay);
    expect(days.map(ymd)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(startOfWeekMonday(focusDay).getDay()).toBe(1);
  });

  it('month view includes every day of the month on a Monday-start grid', () => {
    const days = getDaysInView('month', focusDay);
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(1);
    expect(days[days.length - 1].getDay()).toBe(0);
    const inSeptember = days.filter(
      (day) => day.getFullYear() === 2026 && day.getMonth() === 8,
    );
    expect(inSeptember.map((day) => day.getDate())).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });
});

describe('event times', () => {
  it('chip labels use 24h local start time and the title', () => {
    expect(chipLabel(standup)).toBe('09:00 Standup');
    expect(chipLabel(review)).toBe('14:15 Review');
    expect(chipLabel(fridayOff)).toBe('Friday off');
  });

  it('list times show the local start–end range', () => {
    expect(formatEventListTime(standup)).toMatch(/09:00/);
    expect(formatEventListTime(standup)).toMatch(/09:30/);
    expect(formatEventListTime(review)).toMatch(/14:15/);
    expect(formatEventListTime(review)).toMatch(/15:00/);
    expect(formatEventListTime(fridayOff)).toBe('All day');
  });

  it('list dates match the local day of the event', () => {
    expect(formatEventListDate(standup)).toMatch(/9/);
    expect(formatEventListDate(standup)).toMatch(/Sep/i);
    expect(formatEventListDate(standup)).toMatch(/2026/);
  });

  it('tooltip times include the local start and end', () => {
    expect(formatEventTime(standup)).toMatch(/9:00/i);
    expect(formatEventTime(standup)).toMatch(/9:30/i);
    expect(formatEventTime(review)).toMatch(/2:15/i);
  });
});

describe('day view', () => {
  it('shows waking hour labels and places each timed event in its hour', () => {
    const hours = wakingHourSlots();
    expect(hours[0]).toBe('06:00');
    expect(hours[hours.length - 1]).toBe('22:00');
    expect(hours).not.toContain('23:00');
    expect(hours).not.toContain('05:00');
    expect(hours).toContain('06:00');

    const dayEvents = eventsForDay(displayEvents, focusDay);
    expect(ids(eventsForHourSlot(dayEvents, 9))).toEqual(['standup']);
    expect(ids(eventsForHourSlot(dayEvents, 12))).toEqual(['lunch']);
    expect(eventsForHourSlot(dayEvents, 16)).toEqual([]);
    expect(eventsForHourSlot(dayEvents, 23)).toEqual([]);
  });

  it('keeps sleep hours hidden and shows the wake hour (Rest 02:00 / Morning 09:00)', () => {
    const restUntilWake = { sleepTime: '02:00', wakeTime: '09:00' };
    const hours = wakingHourSlots(restUntilWake);
    expect(hours).toContain('00:00');
    expect(hours).toContain('01:00');
    expect(hours).toContain('09:00');
    expect(hours).toContain('10:00');
    expect(hours).not.toContain('02:00');
    expect(hours).not.toContain('08:00');
  });

  it('shows every waking timed event that starts that day, with times', () => {
    const visible = eventsVisibleInView('day', focusDay, displayEvents);
    expect(ids(visible)).toEqual(['lunch', 'standup']);
    expect(visible.map(chipLabel)).toEqual(['09:00 Standup', '12:00 Lunch']);
  });
});

describe('week view', () => {
  it('puts every in-week event on its weekday, including all-day', () => {
    const days = getDaysInView('week', focusDay);
    const byDay = Object.fromEntries(
      days.map((day) => [ymd(day), ids(gridEventsForDay(displayEvents, day))]),
    );

    expect(byDay['2026-09-07']).toEqual(['planning']);
    expect(byDay['2026-09-09']).toEqual(['lunch', 'standup']);
    expect(byDay['2026-09-10']).toEqual(['review']);
    expect(byDay['2026-09-11']).toEqual(['friday-off']);
    expect(byDay['2026-09-06']).toBeUndefined();
    expect(ids(gridEventsForDay(displayEvents, localDate(2026, 8, 6)))).toEqual([
      'prev-sun',
    ]);
  });

  it('shows all events in the week except cancelled and sleep-hour items', () => {
    const visible = eventsVisibleInView('week', focusDay, displayEvents);
    expect(ids(visible)).toEqual(['friday-off', 'lunch', 'planning', 'review', 'standup']);
    expect(visible.map(chipLabel).sort()).toEqual([
      '09:00 Standup',
      '10:00 Planning',
      '12:00 Lunch',
      '14:15 Review',
      'Friday off',
    ]);
    expect(ids(visible)).not.toContain('cancelled');
    expect(ids(visible)).not.toContain('late');
    expect(ids(visible)).not.toContain('prev-sun');
    expect(ids(visible)).not.toContain('oct');
  });
});

describe('month view', () => {
  it('shows every September event on its day, plus padding-day events from the grid', () => {
    const visible = eventsVisibleInView('month', focusDay, displayEvents);
    expect(ids(visible)).toEqual([
      'friday-off',
      'lunch',
      'oct',
      'planning',
      'prev-sun',
      'review',
      'standup',
    ]);

    const septemberIds = getDaysInView('month', focusDay)
      .filter((day) => day.getMonth() === 8)
      .flatMap((day) => gridEventsForDay(displayEvents, day).map((event) => event.id))
      .sort();
    expect(septemberIds).toEqual([
      'friday-off',
      'lunch',
      'planning',
      'prev-sun',
      'review',
      'standup',
    ]);

    const ninth = gridEventsForDay(displayEvents, focusDay);
    expect(ninth.map(chipLabel).sort()).toEqual(['09:00 Standup', '12:00 Lunch']);
    expect(gridEventsForDay(displayEvents, localDate(2026, 9, 1)).map(chipLabel)).toEqual([
      '09:00 October kickoff',
    ]);
  });
});

describe('query ranges', () => {
  it('day/week/month fetch windows cover the visible period', () => {
    const day = eventsQueryRange('day', focusDay);
    expect(new Date(day.timeMin)).toEqual(localDate(2026, 8, 9, 0, 0));
    expect(new Date(day.timeMax).getHours()).toBe(23);

    const week = eventsQueryRange('week', focusDay);
    expect(new Date(week.timeMin)).toEqual(localDate(2026, 8, 7, 0, 0));
    expect(ymd(new Date(week.timeMax))).toBe('2026-09-13');

    const month = eventsQueryRange('month', focusDay);
    expect(new Date(month.timeMin)).toEqual(localDate(2026, 8, 1, 0, 0));
    expect(ymd(new Date(month.timeMax))).toBe('2026-09-30');
  });

  it('visible ymd ranges match the view labels', () => {
    expect(visibleRangeYmd('day', focusDay)).toEqual({
      startDate: '2026-09-09',
      endDate: '2026-09-09',
    });
    expect(visibleRangeYmd('week', focusDay)).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
    });
    expect(visibleRangeYmd('month', focusDay)).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(periodLabel(focusDay, 'week')).toMatch(/7/);
    expect(periodLabel(focusDay, 'week')).toMatch(/13/);
    expect(ymd(shiftPeriod(focusDay, 'week', 1))).toBe('2026-09-16');
  });
});
