import {
  describeTaskToastDetail,
  describeTaskWhen,
  formatDateTimeRange,
  joinToastDetail,
} from './formatDate';

function localIso(year: number, monthIndex: number, day: number, hour: number, minute: number): string {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

describe('formatDateTimeRange', () => {
  it('returns null when both ends are missing', () => {
    expect(formatDateTimeRange()).toBeNull();
    expect(formatDateTimeRange('', '')).toBeNull();
  });

  it('formats a same-day slot as date plus start–end times', () => {
    const start = localIso(2026, 8, 9, 9, 0);
    const end = localIso(2026, 8, 9, 9, 30);
    const text = formatDateTimeRange(start, end);
    expect(text).toMatch(/9 Sep 2026/);
    expect(text).toMatch(/09:00/);
    expect(text).toMatch(/09:30/);
    expect(text).not.toContain(' – ');
  });

  it('formats a multi-day range with both dates', () => {
    const start = localIso(2026, 8, 9, 9, 0);
    const end = localIso(2026, 8, 10, 18, 0);
    const text = formatDateTimeRange(start, end);
    expect(text).toContain('9 Sep 2026, 09:00');
    expect(text).toContain('10 Sep 2026, 18:00');
    expect(text).toContain(' – ');
  });
});

describe('describeTaskWhen', () => {
  it('prefers the scheduled slot over the From/Until window', () => {
    const text = describeTaskWhen({
      scheduledStartTime: localIso(2026, 8, 9, 14, 0),
      scheduledEndTime: localIso(2026, 8, 9, 15, 0),
      earliestStartTime: localIso(2026, 8, 9, 0, 0),
      deadline: localIso(2026, 8, 9, 23, 59),
      estimatedTimeInMinutes: 60,
    });
    expect(text).toMatch(/14:00/);
    expect(text).toMatch(/15:00/);
    expect(text).not.toMatch(/Between/);
    expect(text).not.toMatch(/min/);
  });

  it('describes a From/Until window when there is no slot', () => {
    const text = describeTaskWhen({
      earliestStartTime: localIso(2026, 8, 9, 0, 0),
      deadline: localIso(2026, 8, 10, 23, 59),
      estimatedTimeInMinutes: 45,
    });
    expect(text).toMatch(/^Between /);
    expect(text).toContain('45 min');
  });

  it('uses Due / From when only one bound exists', () => {
    expect(describeTaskWhen({ deadline: localIso(2026, 8, 10, 18, 0) })).toMatch(/^Due /);
    expect(describeTaskWhen({ earliestStartTime: localIso(2026, 8, 9, 8, 0) })).toMatch(/^From /);
  });

  it('appends a recurrence label', () => {
    const text = describeTaskWhen({
      estimatedTimeInMinutes: 30,
      isRecurring: true,
      recurrencePattern: 'WEEKLY',
    });
    expect(text).toBe('30 min · Repeats weekly');
  });
});

describe('describeTaskToastDetail', () => {
  it('joins the task name with the when line', () => {
    const text = describeTaskToastDetail({
      name: 'Team standup',
      scheduledStartTime: localIso(2026, 8, 9, 9, 0),
      scheduledEndTime: localIso(2026, 8, 9, 9, 30),
    });
    expect(text).toMatch(/^Team standup · /);
    expect(text).toMatch(/09:00/);
  });
});

describe('joinToastDetail', () => {
  it('drops empty parts', () => {
    expect(joinToastDetail('Standup', '  ', undefined, '30 min')).toBe('Standup · 30 min');
    expect(joinToastDetail(null, '  ')).toBeUndefined();
  });
});
