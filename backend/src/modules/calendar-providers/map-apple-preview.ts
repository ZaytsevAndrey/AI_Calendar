import type { EventPerson, ProviderEvent } from './calendar-provider.types';
import type { ParsedVEvent } from './apple-ics.util';

function meetingUrl(url: string): boolean {
  return /meet\.google|zoom\.|teams\.microsoft|facetime|webex|whereby|around\.co/i.test(
    url,
  );
}

/** User-facing iCloud fields parsed from a VEVENT. */
export function appleEventExtras(
  parsed: ParsedVEvent,
): Pick<
  ProviderEvent,
  'attendees' | 'organizer' | 'htmlLink' | 'visibility' | 'reminders' | 'preview'
> {
  const url = parsed.url?.trim();
  const join = url && meetingUrl(url) ? url : undefined;
  const link = url && !join ? url : undefined;
  const attachments = parsed.attachments ?? [];
  const preview: NonNullable<ProviderEvent['preview']> = {};
  if (join) preview.joinLinks = [{ label: join, url: join }];
  if (parsed.structuredLocation) preview.structuredLocation = parsed.structuredLocation;
  if (parsed.categories?.length) preview.categories = parsed.categories;
  if (parsed.comment) preview.comment = parsed.comment;
  if (parsed.priority != null && parsed.priority >= 1 && parsed.priority <= 9) {
    preview.priority = parsed.priority;
  }
  if (parsed.recurrenceText) preview.recurrenceText = parsed.recurrenceText;
  if (attachments.length) preview.attachments = attachments;
  if (parsed.visibility && parsed.visibility !== 'public') {
    preview.sensitivity = parsed.visibility;
  }
  const showAs =
    parsed.transparency === 'transparent'
      ? 'free'
      : parsed.transparency
        ? 'busy'
        : undefined;
  if (showAs) preview.showAs = showAs;

  const attendees: EventPerson[] | undefined = parsed.attendees?.length
    ? parsed.attendees
    : undefined;
  const reminders = parsed.alarmMinutes?.length
    ? {
        useDefault: false,
        overrides: parsed.alarmMinutes.map((minutes) => ({
          method: 'popup',
          minutes,
        })),
      }
    : undefined;

  return {
    attendees,
    organizer: parsed.organizer,
    htmlLink: link,
    visibility: parsed.visibility,
    reminders,
    preview: Object.keys(preview).length ? preview : undefined,
  };
}
