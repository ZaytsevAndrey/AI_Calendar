import type {
  EventPerson,
  EventPreviewDetails,
  ProviderEvent,
} from './calendar-provider.types';

type Loose = Record<string, unknown>;

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export type GraphEventPreviewInput = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  locations?: Array<{ displayName?: string }>;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  seriesMasterId?: string;
  webLink?: string;
  onlineMeetingUrl?: string;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string; tollNumber?: string };
  attendees?: Array<{
    type?: string;
    emailAddress?: { name?: string; address?: string };
    status?: { response?: string };
  }>;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  categories?: string[];
  importance?: string;
  sensitivity?: string;
  recurrence?: {
    pattern?: { type?: string; interval?: number; daysOfWeek?: string[] };
  };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  hasAttachments?: boolean;
};

function mapResponse(value: string | undefined): string | undefined {
  switch ((value || '').toLowerCase()) {
    case 'accepted':
    case 'organizer':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'tentativelyaccepted':
      return 'tentative';
    case 'notresponded':
    case 'none':
      return 'needsAction';
    default:
      return undefined;
  }
}

function mapShowAs(value: string | undefined): string | undefined {
  switch ((value || '').toLowerCase()) {
    case 'free':
      return 'free';
    case 'busy':
      return 'busy';
    case 'tentative':
      return 'tentative';
    case 'oof':
      return 'oof';
    case 'workingelsewhere':
      return 'workingElsewhere';
    default:
      return undefined;
  }
}

/** User-facing Outlook fields. Scheduling fields (start/end/summary) stay with the caller. */
export function microsoftEventExtras(
  ev: GraphEventPreviewInput,
): Pick<
  ProviderEvent,
  | 'description'
  | 'location'
  | 'status'
  | 'transparency'
  | 'attendees'
  | 'organizer'
  | 'htmlLink'
  | 'reminders'
  | 'created'
  | 'updated'
  | 'preview'
> {
  const html =
    ev.body?.contentType?.toLowerCase() === 'html'
      ? text(ev.body.content)
      : undefined;
  const description = text(ev.bodyPreview) || (html ? undefined : text(ev.body?.content));
  const location = text(ev.location?.displayName);
  const extraLocations = (ev.locations ?? [])
    .map((row) => text(row.displayName))
    .filter((name): name is string => !!name && name !== location);

  const attendees: EventPerson[] = [];
  for (const row of ev.attendees ?? []) {
    const email = text(row.emailAddress?.address);
    const displayName = text(row.emailAddress?.name);
    if (!email && !displayName) continue;
    const type = (row.type || '').toLowerCase();
    attendees.push({
      email,
      displayName,
      responseStatus: mapResponse(row.status?.response),
      optional: type === 'optional',
      resource: type === 'resource',
    });
  }

  const organizerEmail = text(ev.organizer?.emailAddress?.address);
  const organizerName = text(ev.organizer?.emailAddress?.name);
  const organizer =
    organizerEmail || organizerName
      ? { email: organizerEmail, displayName: organizerName }
      : undefined;

  const joinUrl = text(ev.onlineMeeting?.joinUrl) || text(ev.onlineMeetingUrl);
  const phone = text(ev.onlineMeeting?.tollNumber);
  const showAs = mapShowAs(ev.showAs);
  const importance = text(ev.importance);
  const sensitivity = text(ev.sensitivity);
  const categories = (ev.categories ?? []).map((item) => item.trim()).filter(Boolean);
  const pattern = ev.recurrence?.pattern;
  const recurrenceText = pattern?.type
    ? [
        pattern.type,
        pattern.interval && pattern.interval !== 1 ? `x${pattern.interval}` : '',
        pattern.daysOfWeek?.length ? pattern.daysOfWeek.join(', ') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const preview: EventPreviewDetails = {};
  if (joinUrl) preview.joinLinks = [{ label: joinUrl, url: joinUrl }];
  if (phone) preview.phones = [phone];
  if (extraLocations.length) preview.locations = extraLocations;
  if (html) preview.descriptionHtml = html;
  if (showAs) preview.showAs = showAs;
  if (importance && importance.toLowerCase() !== 'normal') {
    preview.importance = importance.toLowerCase();
  }
  if (sensitivity && sensitivity.toLowerCase() !== 'normal') {
    preview.sensitivity = sensitivity.toLowerCase();
  }
  if (categories.length) preview.categories = categories;
  if (recurrenceText) preview.recurrenceText = recurrenceText;
  if (ev.hasAttachments) preview.hasAttachments = true;

  const minutes = ev.reminderMinutesBeforeStart;
  const reminders =
    ev.isReminderOn && typeof minutes === 'number'
      ? { useDefault: false, overrides: [{ method: 'popup', minutes }] }
      : undefined;

  return {
    description,
    location,
    status: ev.isCancelled ? 'cancelled' : undefined,
    transparency: showAs === 'free' ? 'transparent' : undefined,
    attendees: attendees.length ? attendees : undefined,
    organizer,
    htmlLink: text(ev.webLink),
    reminders,
    created: text(ev.createdDateTime),
    updated: text(ev.lastModifiedDateTime),
    preview: Object.keys(preview).length ? preview : undefined,
  };
}
