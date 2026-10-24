import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { TaskDTO } from '../../api/tasks.api';

/** Temporary samples so the preview can be reviewed. Not written anywhere. */
export const PREVIEW_MOCK_IDS = {
  google: 'preview-mock-google',
  microsoft: 'preview-mock-microsoft',
  apple: 'preview-mock-apple',
} as const;

function range(hour: number, minute: number, durationMin: number): GoogleCalendarEvent['start'][] {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return [{ dateTime: start.toISOString() }, { dateTime: end.toISOString() }];
}

const GOOGLE_HTML = `<p>Quarterly planning with <strong>design</strong> and <em>engineering</em>.</p>
<ul><li>Read the <a href="https://example.com/notes">shared notes</a></li><li>Pick a date</li></ul>
<p>A drive-by <script>alert(1)</script> must not run.</p>`;

const OUTLOOK_HTML = `<p>Customer call.</p><p>Agenda is on <a href="https://example.com/agenda">the agenda page</a>.</p><ol><li>Status</li><li>Next step</li></ol>`;

const GOOGLE_PLAIN =
  'Quarterly planning with design and engineering. Read the shared notes and pick a date.';

export function previewMockEvents(): GoogleCalendarEvent[] {
  const [gStart, gEnd] = range(10, 0, 60);
  const [mStart, mEnd] = range(11, 30, 45);
  const [aStart, aEnd] = range(14, 0, 90);
  return [
    {
      id: PREVIEW_MOCK_IDS.google,
      summary: 'Sample · Google',
      colorId: '9',
      provider: 'google',
      status: 'confirmed',
      transparency: 'opaque',
      location: 'https://maps.example.com/hq',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=sample',
      created: new Date(Date.now() - 3 * 86400_000).toISOString(),
      updated: new Date(Date.now() - 3600_000).toISOString(),
      start: gStart,
      end: gEnd,
      organizer: { email: 'ada@example.com', displayName: 'Ada Lovelace', self: true },
      attendees: [
        { email: 'ada@example.com', displayName: 'Ada Lovelace', responseStatus: 'accepted', self: true },
        { email: 'grace@example.com', displayName: 'Grace Hopper', responseStatus: 'tentative', optional: true },
        { email: 'room@example.com', displayName: 'Room 4', responseStatus: 'accepted', resource: true },
      ],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }] },
      visibility: 'private',
      description: GOOGLE_PLAIN,
      preview: {
        calendarName: 'Work',
        descriptionHtml: GOOGLE_HTML,
        showAs: 'busy',
        sensitivity: 'private',
        eventKind: 'focusTime',
        joinLinks: [{ label: 'Google Meet', url: 'https://meet.google.com/abc-defg-hij' }],
        phones: ['+1 555 010 2000'],
        attachments: [{ label: 'Brief.pdf', url: 'https://example.com/brief.pdf' }],
        source: { label: 'From Gmail', url: 'https://mail.google.com/mail/u/0/#inbox/sample' },
        categories: ['Planning'],
      },
    },
    {
      id: PREVIEW_MOCK_IDS.microsoft,
      summary: 'Sample · Outlook',
      colorId: '7',
      provider: 'microsoft',
      status: 'confirmed',
      location: 'Contoso HQ, 1 Market Street',
      htmlLink: 'https://outlook.office.com/calendar/item/sample',
      created: new Date(Date.now() - 2 * 86400_000).toISOString(),
      updated: new Date(Date.now() - 7200_000).toISOString(),
      start: mStart,
      end: mEnd,
      description: 'Customer call. Agenda is on the agenda page.',
      organizer: { email: 'sam@contoso.com', displayName: 'Sam Rivera' },
      attendees: [
        { email: 'sam@contoso.com', displayName: 'Sam Rivera', responseStatus: 'accepted' },
        { email: 'lee@contoso.com', displayName: 'Lee Chen', responseStatus: 'needsAction' },
      ],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      preview: {
        calendarName: 'Calendar',
        descriptionHtml: OUTLOOK_HTML,
        showAs: 'busy',
        importance: 'high',
        sensitivity: 'confidential',
        joinLinks: [{ label: 'https://teams.microsoft.com/l/meetup-join/sample', url: 'https://teams.microsoft.com/l/meetup-join/sample' }],
        phones: ['+1 555 019 1000'],
        locations: ['Building B'],
        categories: ['Client', 'Blue category'],
        recurrenceText: 'weekly · Monday, Wednesday',
        hasAttachments: true,
      },
    },
    {
      id: PREVIEW_MOCK_IDS.apple,
      summary: 'Sample · iCloud',
      colorId: '10',
      provider: 'apple',
      status: 'tentative',
      transparency: 'transparent',
      location: 'Home',
      htmlLink: 'https://example.com/family-notes',
      start: aStart,
      end: aEnd,
      description: 'Bring the spare key. Map: https://maps.example.com/home',
      organizer: { email: 'me@icloud.com', displayName: 'Me' },
      attendees: [
        { email: 'me@icloud.com', displayName: 'Me', responseStatus: 'accepted', self: true },
        { email: 'kim@example.com', displayName: 'Kim', responseStatus: 'declined', optional: true },
      ],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      preview: {
        calendarName: 'Family',
        showAs: 'free',
        sensitivity: 'private',
        structuredLocation: '12 Garden Lane',
        categories: ['Family', 'Errand'],
        comment: 'Park on the street',
        priority: 1,
        recurrenceText: 'FREQ=WEEKLY;BYDAY=SA',
        attachments: [{ label: 'list.txt', url: 'https://example.com/list.txt' }],
        joinLinks: [{ label: 'FaceTime', url: 'https://facetime.apple.com/join#sample' }],
      },
    },
  ];
}

export function previewMockTask(eventId: string | undefined | null): TaskDTO | null {
  if (eventId !== PREVIEW_MOCK_IDS.google) return null;
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    id: 'preview-mock-task',
    name: 'Sample · Google',
    description: GOOGLE_PLAIN,
    eventType: 'fixed',
    phase: { id: 'phase-focus', name: 'Focus', color: '#3f51b5' },
    phases: [{ id: 'phase-focus', name: 'Focus', color: '#3f51b5' }],
    estimatedTimeInMinutes: 60,
    isRecurring: true,
    recurrencePattern: 'WEEKLY',
    recurrenceWeekDays: [1, 3],
    skippedOccurrenceYmds: ['2026-10-20'],
    allowSplit: true,
    priority: 'high',
    deadline: new Date(start.getTime() + 2 * 86400_000).toISOString(),
    earliestStartTime: new Date(start.getTime() - 2 * 3600_000).toISOString(),
    eligibleWeekDays: [1, 2, 3, 4, 5],
    scheduleTimeZone: 'Europe/Kyiv',
    status: 'in_progress',
    scheduledStartTime: start.toISOString(),
    scheduledEndTime: end.toISOString(),
    isFixedExternal: false,
    isUnscheduled: false,
    scheduleState: 'problematic',
    problematicOccurrenceYmds: ['2026-10-22'],
    problematicReason: 'phase_full',
    problematicDay: '2026-10-22',
    problematicOriginalStart: start.toISOString(),
    problematicOriginalEnd: end.toISOString(),
    location: 'https://maps.example.com/hq',
    googleColorId: '9',
    googleVisibility: 'private',
    googleTransparency: 'opaque',
    googleReminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
    createdAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  };
}
