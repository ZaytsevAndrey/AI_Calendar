import type {
  EventLink,
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

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function person(raw: unknown): EventPerson | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Loose;
  const email = text(row.email);
  const displayName = text(row.displayName);
  if (!email && !displayName) return undefined;
  const response = text(row.responseStatus);
  return {
    email,
    displayName,
    responseStatus: response,
    self: row.self === true,
    optional: row.optional === true,
  };
}

function workingLocationDetail(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const props = raw as Loose;
  const type = text(props.type);
  if (type === 'home') return 'home';
  if (type === 'office') {
    const office = props.officeLocation as Loose | undefined;
    return text(office?.label) || text(office?.buildingId) || 'office';
  }
  if (type === 'custom') {
    const custom = props.customLocation as Loose | undefined;
    return text(custom?.label);
  }
  return undefined;
}

function kindFrom(raw: Loose): { eventKind?: string; kindDetail?: string } {
  const eventType = text(raw.eventType);
  if (!eventType || eventType === 'default') return {};
  if (eventType === 'workingLocation') {
    return {
      eventKind: 'workingLocation',
      kindDetail: workingLocationDetail(raw.workingLocationProperties),
    };
  }
  if (eventType === 'outOfOffice') {
    const props = raw.outOfOfficeProperties as Loose | undefined;
    return { eventKind: 'outOfOffice', kindDetail: text(props?.declineMessage) };
  }
  if (eventType === 'focusTime') return { eventKind: 'focusTime' };
  if (eventType === 'birthday') return { eventKind: 'birthday' };
  if (eventType === 'fromGmail') return { eventKind: 'fromGmail' };
  return { eventKind: eventType };
}

/** Copy user-facing Google Calendar fields onto a provider event. */
export function googleEventExtras(
  raw: Loose,
): Pick<
  ProviderEvent,
  | 'attendees'
  | 'organizer'
  | 'htmlLink'
  | 'visibility'
  | 'reminders'
  | 'created'
  | 'updated'
  | 'preview'
> {
  const attendees = Array.isArray(raw.attendees)
    ? raw.attendees
        .map(person)
        .filter((row): row is EventPerson => !!row)
    : [];
  const organizer = person(raw.organizer);
  const htmlLink = text(raw.htmlLink);
  const visibility = text(raw.visibility);
  const created = text(raw.created);
  const updated = text(raw.updated);
  const description = text(raw.description);

  const remindersRaw = raw.reminders as Loose | undefined;
  const overrides: { method?: string; minutes: number }[] = [];
  if (Array.isArray(remindersRaw?.overrides)) {
    for (const item of remindersRaw.overrides) {
      const row = item as Loose;
      const minutes = Number(row.minutes);
      if (!Number.isFinite(minutes)) continue;
      overrides.push({ method: text(row.method), minutes });
    }
  }
  const reminders =
    remindersRaw && (remindersRaw.useDefault === true || overrides.length > 0)
      ? { useDefault: remindersRaw.useDefault === true, overrides }
      : undefined;

  const joinLinks: EventLink[] = [];
  const phones: string[] = [];
  const seenJoin = new Set<string>();
  const pushJoin = (url: string | undefined, label: string | undefined) => {
    if (!url || seenJoin.has(url)) return;
    seenJoin.add(url);
    joinLinks.push({ label: label || url, url });
  };
  const conference = raw.conferenceData as Loose | undefined;
  const solution = conference?.conferenceSolution as Loose | undefined;
  const solutionName = text(solution?.name);
  const entryPoints = Array.isArray(conference?.entryPoints)
    ? conference.entryPoints
    : [];
  for (const entry of entryPoints) {
    const row = entry as Loose;
    const uri = text(row.uri);
    const type = text(row.entryPointType);
    const label = text(row.label) || solutionName;
    if (type === 'phone' && uri) {
      phones.push(label && label !== uri ? `${label}` : uri.replace(/^tel:/i, ''));
      continue;
    }
    if (uri && (type === 'video' || type === 'more' || !type)) {
      pushJoin(uri, label);
    }
  }
  pushJoin(text(raw.hangoutLink), solutionName || 'Google Meet');

  const attachments: EventLink[] = [];
  if (Array.isArray(raw.attachments)) {
    for (const item of raw.attachments) {
      const row = item as Loose;
      const url = text(row.fileUrl);
      const label = text(row.title) || url;
      if (!label) continue;
      attachments.push({ label, url });
    }
  }

  const sourceRaw = raw.source as Loose | undefined;
  const sourceUrl = text(sourceRaw?.url);
  const sourceTitle = text(sourceRaw?.title);
  const source =
    sourceUrl || sourceTitle
      ? { label: sourceTitle || sourceUrl || '', url: sourceUrl }
      : undefined;

  const kind = kindFrom(raw);
  const preview: EventPreviewDetails = {};
  if (joinLinks.length) preview.joinLinks = joinLinks;
  if (phones.length) preview.phones = phones;
  if (attachments.length) preview.attachments = attachments;
  if (source) preview.source = source;
  if (kind.eventKind) preview.eventKind = kind.eventKind;
  if (kind.kindDetail) preview.kindDetail = kind.kindDetail;
  if (description && looksLikeHtml(description)) {
    preview.descriptionHtml = description;
  }
  const sensitivity =
    visibility && visibility !== 'default' && visibility !== 'public'
      ? visibility
      : undefined;
  if (sensitivity) preview.sensitivity = sensitivity;

  const transparency = text(raw.transparency);
  if (transparency === 'transparent') preview.showAs = 'free';
  else if (transparency === 'opaque') preview.showAs = 'busy';

  return {
    attendees: attendees.length ? attendees : undefined,
    organizer,
    htmlLink,
    visibility,
    reminders,
    created,
    updated,
    preview: Object.keys(preview).length ? preview : undefined,
  };
}
