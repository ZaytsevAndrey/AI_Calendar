import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { TaskDTO } from '../../api/tasks.api';
import { looksLikeHtml, stripHtml } from './eventPreviewText';

export type PreviewPerson = {
  name: string;
  tags: Array<'you' | 'accepted' | 'declined' | 'tentative' | 'needsAction' | 'required' | 'optional' | 'resource'>;
};

export type PreviewLink = { label: string; url?: string };

export type PreviewFact =
  | { kind: 'text'; id: string; label: string; text: string }
  | { kind: 'links'; id: string; label: string; links: PreviewLink[] }
  | { kind: 'people'; id: string; label: string; people: PreviewPerson[] }
  | {
      kind: 'reminders';
      id: string;
      label: string;
      items: Array<{ method: 'popup' | 'email' | 'default'; minutes?: number }>;
    };

type Person = NonNullable<GoogleCalendarEvent['attendees']>[number];

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function responseTag(status: string | undefined): PreviewPerson['tags'][number] | null {
  switch (status) {
    case 'accepted':
    case 'declined':
    case 'tentative':
    case 'needsAction':
      return status;
    default:
      return null;
  }
}

function toPerson(person: Person, role: 'required' | 'optional' | 'omit'): PreviewPerson | null {
  const name = clean(person.displayName) || clean(person.email);
  if (!name) return null;
  const tags: PreviewPerson['tags'] = [];
  if (person.self) tags.push('you');
  const response = responseTag(person.responseStatus);
  if (response) tags.push(response);
  if (person.resource) tags.push('resource');
  else if (person.optional || role === 'optional') tags.push('optional');
  else if (role === 'required') tags.push('required');
  return { name, tags };
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Task weekdays use 0 = Sunday … 6 = Saturday. */
export function weekdayKey(day: number): (typeof WEEKDAY_KEYS)[number] | null {
  if (day >= 0 && day <= 6) return WEEKDAY_KEYS[day];
  return null;
}

function reminderItems(
  reminders: GoogleCalendarEvent['reminders'] | TaskDTO['googleReminders'] | null | undefined,
): Array<{ method: 'popup' | 'email' | 'default'; minutes?: number }> {
  if (!reminders) return [];
  const items: Array<{ method: 'popup' | 'email' | 'default'; minutes?: number }> = [];
  if (reminders.useDefault) items.push({ method: 'default' });
  for (const row of reminders.overrides ?? []) {
    const method = row.method === 'email' ? 'email' : 'popup';
    items.push({ method, minutes: row.minutes });
  }
  return items;
}

function showAsText(value: string | undefined): string | null {
  switch (value) {
    case 'free':
    case 'transparent':
      return 'free';
    case 'busy':
    case 'opaque':
      return 'busy';
    case 'tentative':
      return 'tentative';
    case 'oof':
      return 'oof';
    case 'workingElsewhere':
      return 'workingElsewhere';
    default:
      return null;
  }
}

function kindText(value: string | undefined): string | null {
  switch (value) {
    case 'outOfOffice':
    case 'focusTime':
    case 'workingLocation':
    case 'birthday':
    case 'fromGmail':
      return value;
    default:
      return null;
  }
}

/**
 * Rows for the preview. A fact is omitted when the source field is empty.
 * `text` for coded values (status, showAs, kind, priority, type) is a stable code
 * the view translates. Free text is passed through.
 */
export function buildEventPreviewFacts(
  event: GoogleCalendarEvent,
  task: TaskDTO | null,
  calendarName?: string | null,
): PreviewFact[] {
  const preview = event.preview;
  const facts: PreviewFact[] = [];
  const pushText = (id: string, label: string, text: string | undefined | null) => {
    const value = clean(text ?? undefined);
    if (!value) return;
    facts.push({ kind: 'text', id, label, text: value });
  };

  const provider = event.provider ?? 'google';
  const name = clean(calendarName) || clean(preview?.calendarName);
  if (provider || name) {
    facts.push({
      kind: 'text',
      id: 'calendar',
      label: 'calendar',
      text: [provider, name].filter(Boolean).join('|'),
    });
  }

  const kind = kindText(preview?.eventKind);
  if (kind) pushText('kind', 'kind', kind);
  pushText('kindDetail', 'detail', preview?.kindDetail);

  if (event.status) pushText('status', 'status', event.status);
  const showAs =
    showAsText(preview?.showAs) ||
    showAsText(event.transparency) ||
    showAsText(task?.googleTransparency ?? undefined);
  if (showAs) pushText('showAs', 'showAs', showAs);
  if (preview?.importance === 'low' || preview?.importance === 'high') {
    pushText('importance', 'importance', preview.importance);
  }
  const sensitivity = clean(preview?.sensitivity) || clean(event.visibility) || clean(task?.googleVisibility);
  if (sensitivity && sensitivity !== 'default' && sensitivity !== 'public' && sensitivity !== 'normal') {
    pushText('sensitivity', 'sensitivity', sensitivity);
  }

  const locations = [
    clean(task?.location) || clean(event.location),
    clean(preview?.structuredLocation),
    ...(preview?.locations ?? []).map((item) => clean(item)),
  ].filter((item, index, all): item is string => !!item && all.indexOf(item) === index);
  if (locations.length) {
    facts.push({
      kind: 'links',
      id: 'location',
      label: 'location',
      links: locations.map((value) =>
        /^https?:\/\//i.test(value) ? { label: value, url: value } : { label: value },
      ),
    });
  }

  const join = (preview?.joinLinks ?? []).filter((link) => clean(link.url) || clean(link.label));
  if (join.length) {
    facts.push({ kind: 'links', id: 'join', label: 'join', links: join });
  }
  const phones = (preview?.phones ?? []).map((item) => clean(item)).filter((item): item is string => !!item);
  if (phones.length) {
    facts.push({
      kind: 'links',
      id: 'phone',
      label: 'phone',
      links: phones.map((value) => ({
        label: value.replace(/^tel:/i, ''),
        url: value.toLowerCase().startsWith('tel:') ? value : `tel:${value}`,
      })),
    });
  }
  if (clean(event.htmlLink)) {
    facts.push({
      kind: 'links',
      id: 'open',
      label: 'open',
      links: [{ label: provider, url: event.htmlLink }],
    });
  }
  if (preview?.source && (clean(preview.source.url) || clean(preview.source.label))) {
    facts.push({
      kind: 'links',
      id: 'source',
      label: 'source',
      links: [preview.source],
    });
  }

  pushText('recurrence', 'recurrence', preview?.recurrenceText);
  if (!preview?.recurrenceText && (event.recurringEventId || task?.isRecurring)) {
    pushText('recurrence', 'recurrence', task?.recurrencePattern || 'recurring');
  }

  if (event.organizer) {
    const person = toPerson(event.organizer, 'omit');
    if (person) facts.push({ kind: 'people', id: 'organizer', label: 'organizer', people: [person] });
  }
  const people = (event.attendees ?? [])
    .map((person) => toPerson(person, 'omit'))
    .filter((person): person is PreviewPerson => !!person);
  if (people.length) facts.push({ kind: 'people', id: 'attendees', label: 'attendees', people });

  if (preview?.categories?.length) {
    pushText('categories', 'categories', preview.categories.join(', '));
  }

  const reminders = reminderItems(event.reminders) ;
  const taskReminders = reminders.length ? [] : reminderItems(task?.googleReminders);
  const reminderRows = reminders.length ? reminders : taskReminders;
  if (reminderRows.length) {
    facts.push({ kind: 'reminders', id: 'reminders', label: 'reminders', items: reminderRows });
  }

  const attachments = (preview?.attachments ?? []).filter((item) => clean(item.label) || clean(item.url));
  if (attachments.length) {
    facts.push({ kind: 'links', id: 'attachments', label: 'attachments', links: attachments });
  } else if (preview?.hasAttachments) {
    pushText('attachments', 'attachments', 'yes');
  }

  pushText('comment', 'comment', preview?.comment);
  if (preview?.priority != null && preview.priority >= 1 && preview.priority <= 9) {
    pushText('applePriority', 'priority', String(preview.priority));
  }

  if (task) facts.push(...taskFacts(task, event));

  pushText('created', 'created', event.created || task?.createdAt);
  pushText('updated', 'updated', event.updated || task?.updatedAt);
  return facts;
}

function taskFacts(task: TaskDTO, event: GoogleCalendarEvent): PreviewFact[] {
  const facts: PreviewFact[] = [];
  const push = (id: string, label: string, text: string | undefined | null) => {
    const value = clean(text ?? undefined);
    if (!value) return;
    facts.push({ kind: 'text', id, label, text: value });
  };

  if (task.isUnscheduled) push('type', 'type', 'unscheduled');
  else if (task.isRecurring) push('type', 'type', 'recurring');
  else if (task.eventType === 'fixed' || task.isFixedExternal) push('type', 'type', 'fixed');
  else if (task.eventType) push('type', 'type', task.eventType === 'admin' ? 'flexible' : task.eventType);

  const phases = (task.phases?.map((phase) => phase.name) ?? []).filter(Boolean);
  if (!phases.length && task.phase?.name) phases.push(task.phase.name);
  push('phase', 'phase', phases.join(', '));
  push('taskStatus', 'taskStatus', task.status);
  push('priority', 'priority', task.priority);
  if (task.estimatedTimeInMinutes > 0) {
    push('duration', 'duration', String(task.estimatedTimeInMinutes));
  }
  push('deadline', 'deadline', task.deadline);
  push('windowFrom', 'windowFrom', task.earliestStartTime);
  const eligible = (task.eligibleWeekDays ?? [])
    .map(weekdayKey)
    .filter((day): day is NonNullable<ReturnType<typeof weekdayKey>> => !!day);
  push('eligibleDays', 'eligibleDays', eligible.join(','));
  push('timeZone', 'timeZone', task.scheduleTimeZone);
  const repeatDays = (task.recurrenceWeekDays ?? [])
    .map(weekdayKey)
    .filter((day): day is NonNullable<ReturnType<typeof weekdayKey>> => !!day);
  if (task.isRecurring && repeatDays.length && !event.preview?.recurrenceText) {
    push('repeatDays', 'repeatDays', repeatDays.join(','));
  }
  if (task.skippedOccurrenceYmds?.length) {
    push('skippedDays', 'skippedDays', task.skippedOccurrenceYmds.join(', '));
  }
  if (task.allowSplit) push('allowSplit', 'allowSplit', 'yes');
  if (task.isFixedExternal) push('fixedExternal', 'fixedExternal', 'yes');
  if (task.scheduleState && task.scheduleState !== 'none') {
    push('scheduleState', 'scheduleState', task.scheduleState);
  }
  push('problematicReason', 'problematicReason', task.problematicReason);
  push('problematicDay', 'problematicDay', task.problematicDay);
  if (task.problematicOriginalStart || task.problematicOriginalEnd) {
    push(
      'originalTime',
      'originalTime',
      [task.problematicOriginalStart, task.problematicOriginalEnd].filter(Boolean).join('|'),
    );
  }
  if (task.problematicOccurrenceYmds?.length) {
    push('problematicDays', 'problematicDays', task.problematicOccurrenceYmds.join(', '));
  }
  const color = task.googleColorId?.trim();
  if (color && Number(color) >= 1 && Number(color) <= 11) {
    push('color', 'color', color);
  }
  return facts;
}

export function descriptionSources(
  event: GoogleCalendarEvent,
  task: TaskDTO | null,
): { plain: string; html: string | null } {
  const html = clean(event.preview?.descriptionHtml) || null;
  const raw = clean(task?.description) || clean(event.description) || '';
  const plain = looksLikeHtml(raw) ? stripHtml(raw) : raw;
  const fromHtml = html ? stripHtml(html) : '';
  return {
    plain: plain || fromHtml,
    html: html || (looksLikeHtml(raw) ? raw : null),
  };
}
