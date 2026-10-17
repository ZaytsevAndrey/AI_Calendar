import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { createDAVClient, type DAVCalendar } from 'tsdav';
import { UserIdentitiesService } from '../auth/user-identities.service';
import { appEventBodyFromGoogle, buildVEventIcs } from './app-event-body';
import type {
  CalendarProvider,
  ProviderCalendar,
  ProviderEvent,
  ProviderEventPatch,
} from './calendar-provider.types';
import { parseVEvent, patchVEventIcs } from './apple-ics.util';
import {
  decodeAppleObjectId,
  encodeAppleObjectId,
} from './apple-event-id.util';

/** Trailing slash matters for iCloud principal discovery (tsdav #238). */
const ICLOUD_CALDAV = 'https://caldav.icloud.com/';

type DavClient = Awaited<ReturnType<typeof createDAVClient>>;

type DavObject = {
  url: string;
  data?: string;
  etag?: string;
};

/** iCloud object hrefs often omit `.ics`; tsdav's default filter drops them. */
const acceptAnyObjectUrl = (url?: string) => Boolean(url && url.trim());

function calendarDisplayName(cal: DAVCalendar, index: number): string {
  const raw = cal.displayName as unknown;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && 'value' in (raw as object)) {
    const v = String((raw as { value?: unknown }).value ?? '').trim();
    if (v) return v;
  }
  return cal.url || `Calendar ${index + 1}`;
}

/** Reminders calendars are VTODO-only — skip for event listing. */
function isVeventCalendar(cal: DAVCalendar): boolean {
  const comps = (cal as { components?: unknown }).components;
  if (!Array.isArray(comps) || comps.length === 0) return true;
  return comps.some((c) => String(c).toUpperCase() === 'VEVENT');
}

function isIncompleteResponse(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /incomplete response/i.test(msg);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LIST_EVENTS_CACHE_TTL_MS = 20_000;
const CALENDARS_CACHE_TTL_MS = 60_000;
/** Cap hung CalDAV calendars (e.g. iCloud 404 that never returns). */
const CALENDAR_FETCH_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout after ${ms}ms (${label})`));
    }, ms);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Normalize to ISO8601 without ms — friendlier for CalDAV time-range. */
function toCalDavIso(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return iso.replace(/\.\d{3}Z$/, 'Z');
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function eventOverlapsRange(
  parsed: {
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  },
  rangeStartMs: number,
  rangeEndMs: number,
): boolean {
  const startIso = parsed.start?.dateTime
    ? parsed.start.dateTime
    : parsed.start?.date
      ? `${parsed.start.date}T00:00:00.000Z`
      : null;
  if (!startIso) return false;
  const endIso = parsed.end?.dateTime
    ? parsed.end.dateTime
    : parsed.end?.date
      ? `${parsed.end.date}T23:59:59.999Z`
      : startIso;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return s < rangeEndMs && e > rangeStartMs;
}

@Injectable()
export class AppleCalendarProvider implements CalendarProvider {
  readonly id = 'apple' as const;
  private readonly logger = new Logger(AppleCalendarProvider.name);
  private readonly listEventsCache = new Map<
    string,
    { at: number; startMs: number; endMs: number; events: ProviderEvent[] }
  >();
  private readonly listEventsInflight = new Map<
    string,
    Promise<ProviderEvent[]>
  >();
  private readonly calendarsCache = new Map<
    string,
    { at: number; calendars: DAVCalendar[] }
  >();

  constructor(private readonly identities: UserIdentitiesService) {}

  /** CalDAV needs no server-side Apple Developer app — always available. */
  isConfigured(): boolean {
    return true;
  }

  async isConnected(userId: string): Promise<boolean> {
    const rows = await this.identities.listForUser(userId);
    return rows.some((r) => r.provider === 'apple' && !!r.accessToken);
  }

  /**
   * Verify Apple ID + app-specific password against iCloud CalDAV, then store.
   */
  async connectCalDav(
    userId: string,
    appleId: string,
    appSpecificPassword: string,
  ): Promise<{ email: string; calendarCount: number }> {
    const email = appleId.trim().toLowerCase();
    // Apple shows passwords as xxxx-xxxx-xxxx-xxxx; Basic auth wants no spaces/dashes.
    const password = appSpecificPassword.replace(/[\s-]+/g, '');
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Apple ID must be an email address');
    }
    if (!password || password.length < 8) {
      throw new BadRequestException('App-specific password is required');
    }
    let calendarCount = 0;
    try {
      const client = await this.createClient(email, password);
      const calendars = await client.fetchCalendars();
      if (!Array.isArray(calendars) || calendars.length === 0) {
        throw new Error('No calendars returned from iCloud');
      }
      calendarCount = calendars.length;
      this.logger.log(
        `Apple CalDAV connect ok for ${email}: ${calendarCount} calendar(s)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Apple CalDAV connect failed for ${email}: ${msg}`);
      throw new UnauthorizedException(
        'Could not connect to iCloud Calendar. Check Apple ID and app-specific password.',
      );
    }
    // Replace any previous Apple CalDAV link for this user.
    const existing = await this.identities.listForUser(userId);
    if (existing.some((r) => r.provider === 'apple')) {
      await this.identities.disconnect(userId, 'apple');
    }
    await this.identities.upsert({
      userId,
      provider: 'apple',
      providerUserId: email,
      email,
      accessToken: password,
      refreshToken: null,
      tokenExpiry: null,
      isRegistrationIdentity: false,
    });
    for (const key of this.listEventsCache.keys()) {
      if (key.startsWith(`${userId}|`)) this.listEventsCache.delete(key);
    }
    for (const key of this.calendarsCache.keys()) {
      if (key.startsWith(`${userId}|`)) this.calendarsCache.delete(key);
    }
    return { email, calendarCount };
  }

  async listCalendars(userId: string): Promise<ProviderCalendar[]> {
    const calendars = await this.calendarsForUser(userId, false);
    return calendars
      .filter((c) => !!c.url)
      .map((c, index) => ({
        id: c.url!,
        summary: calendarDisplayName(c, index),
        primary: index === 0,
        selected: true,
        accessRole: 'writer',
        provider: 'apple' as const,
      }));
  }

  async listEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    const start = toCalDavIso(timeMin);
    const end = toCalDavIso(timeMax);
    const rangeStartMs = new Date(start).getTime();
    const rangeEndMs = new Date(end).getTime();
    const cacheKey = `${userId}|${start}|${end}`;

    const fromCache = this.eventsFromCache(userId, rangeStartMs, rangeEndMs);
    if (fromCache) return fromCache;

    const coveringInflight = this.findCoveringInflight(
      userId,
      rangeStartMs,
      rangeEndMs,
    );
    if (coveringInflight) {
      const events = await coveringInflight;
      return this.filterEventsToRange(events, rangeStartMs, rangeEndMs);
    }

    const existing = this.listEventsInflight.get(cacheKey);
    if (existing) return existing;

    const pending = this.loadEvents(
      userId,
      start,
      end,
      rangeStartMs,
      rangeEndMs,
      cacheKey,
    ).finally(() => {
      this.listEventsInflight.delete(cacheKey);
    });
    this.listEventsInflight.set(cacheKey, pending);
    return pending;
  }

  private eventsFromCache(
    userId: string,
    rangeStartMs: number,
    rangeEndMs: number,
  ): ProviderEvent[] | null {
    const now = Date.now();
    for (const [key, entry] of this.listEventsCache) {
      if (!key.startsWith(`${userId}|`)) continue;
      if (now - entry.at >= LIST_EVENTS_CACHE_TTL_MS) continue;
      if (entry.startMs <= rangeStartMs && entry.endMs >= rangeEndMs) {
        return this.filterEventsToRange(entry.events, rangeStartMs, rangeEndMs);
      }
    }
    return null;
  }

  private findCoveringInflight(
    userId: string,
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<ProviderEvent[]> | null {
    for (const [key, pending] of this.listEventsInflight) {
      if (!key.startsWith(`${userId}|`)) continue;
      const parts = key.split('|');
      if (parts.length < 3) continue;
      const startMs = new Date(parts[1]).getTime();
      const endMs = new Date(parts[2]).getTime();
      if (startMs <= rangeStartMs && endMs >= rangeEndMs) {
        return pending;
      }
    }
    return null;
  }

  private filterEventsToRange(
    events: ProviderEvent[],
    rangeStartMs: number,
    rangeEndMs: number,
  ): ProviderEvent[] {
    return events.filter((ev) =>
      eventOverlapsRange(
        { start: ev.start, end: ev.end },
        rangeStartMs,
        rangeEndMs,
      ),
    );
  }

  private async calendarsForUser(
    userId: string,
    veventOnly = true,
  ): Promise<DAVCalendar[]> {
    const cacheKey = `${userId}|${veventOnly ? 'vevent' : 'all'}`;
    const cached = this.calendarsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CALENDARS_CACHE_TTL_MS) {
      return cached.calendars;
    }
    const client = await this.clientForUser(userId);
    if (!client) return [];
    const calendars = ((await client.fetchCalendars()) ?? []).filter(
      (c) => !!c.url && (!veventOnly || isVeventCalendar(c)),
    );
    this.calendarsCache.set(cacheKey, { at: Date.now(), calendars });
    return calendars;
  }

  private async loadEvents(
    userId: string,
    start: string,
    end: string,
    rangeStartMs: number,
    rangeEndMs: number,
    cacheKey: string,
  ): Promise<ProviderEvent[]> {
    const client = await this.clientForUser(userId);
    if (!client) {
      this.logger.debug(`Apple listEvents: not connected for ${userId}`);
      return [];
    }
    const calendars = await this.calendarsForUser(userId);
    this.logger.log(
      `Apple listEvents ${start}..${end}: ${calendars.length} event calendar(s)`,
    );

    const perCal = await Promise.all(
      calendars.map(async (cal) => {
        const label = calendarDisplayName(cal, 0);
        const url = cal.url!;
        try {
          const objects = await withTimeout(
            this.fetchObjectsForRange(client, cal, start, end, label),
            CALENDAR_FETCH_TIMEOUT_MS,
            label,
          );
          const events: ProviderEvent[] = [];
          let parsedOk = 0;
          let skipped = 0;
          for (const obj of objects) {
            if (!obj?.data || !obj.url) {
              skipped += 1;
              continue;
            }
            const parsed = parseVEvent(obj.data);
            if (!parsed?.start) {
              skipped += 1;
              continue;
            }
            if (!eventOverlapsRange(parsed, rangeStartMs, rangeEndMs)) {
              skipped += 1;
              continue;
            }
            parsedOk += 1;
            events.push({
              id: encodeAppleObjectId(obj.url),
              calendarId: url,
              summary: parsed.summary,
              description: parsed.description,
              location: parsed.location,
              start: parsed.start,
              end: parsed.end ?? parsed.start,
              recurringEventId: parsed.recurringEventId,
              status: parsed.status,
              transparency: parsed.transparency,
              isAppGenerated: false,
              provider: 'apple',
            });
          }
          this.logger.log(
            `Apple calendar ${label}: ${objects.length} object(s), ${parsedOk} event(s), ${skipped} skipped`,
          );
          return events;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Skip Apple calendar ${label}: ${msg}`);
          return [] as ProviderEvent[];
        }
      }),
    );

    const events = perCal.flat();
    this.listEventsCache.set(cacheKey, {
      at: Date.now(),
      startMs: rangeStartMs,
      endMs: rangeEndMs,
      events,
    });
    return events;
  }

  /**
   * Time-range query only. Empty result means empty — do not dump the whole
   * calendar (that was the slow path when iCloud returned 0 for a range).
   */
  private async fetchObjectsForRange(
    client: DavClient,
    cal: DAVCalendar,
    start: string,
    end: string,
    label: string,
  ): Promise<DavObject[]> {
    try {
      return await this.fetchObjects(client, cal, {
        start,
        end,
        useMultiGet: true,
      });
    } catch (e) {
      if (!isIncompleteResponse(e)) throw e;
      this.logger.warn(
        `Apple calendar ${label}: multiget incomplete, retrying without multiget`,
      );
      return await this.fetchObjects(client, cal, {
        start,
        end,
        useMultiGet: false,
      });
    }
  }

  private async fetchObjects(
    client: DavClient,
    cal: DAVCalendar,
    opts: { start?: string; end?: string; useMultiGet: boolean },
  ): Promise<DavObject[]> {
    const params: Parameters<DavClient['fetchCalendarObjects']>[0] = {
      calendar: cal,
      urlFilter: acceptAnyObjectUrl,
      useMultiGet: opts.useMultiGet,
      expand: false,
    };
    if (opts.start && opts.end) {
      params.timeRange = { start: opts.start, end: opts.end };
    }
    return (await client.fetchCalendarObjects(params)) as DavObject[];
  }

  async updateEvent(
    userId: string,
    eventId: string,
    patch: ProviderEventPatch,
    calendarId?: string,
  ): Promise<ProviderEvent | null> {
    const client = await this.clientForUser(userId);
    if (!client) return null;
    const objectUrl = decodeAppleObjectId(eventId);
    const found = await this.findObject(client, objectUrl, calendarId);
    if (!found?.object?.data) return null;
    const nextData = patchVEventIcs(found.object.data, {
      summary: patch.summary,
      description: patch.description,
      location: patch.location,
      startIso: patch.start?.dateTime,
      endIso: patch.end?.dateTime,
    });
    await client.updateCalendarObject({
      calendarObject: {
        url: found.object.url,
        data: nextData,
        etag: found.object.etag,
      },
    });
    const parsed = parseVEvent(nextData);
    if (!parsed?.start) return null;
    return {
      id: encodeAppleObjectId(found.object.url),
      calendarId: found.calendar.url,
      summary: parsed.summary,
      description: parsed.description,
      location: parsed.location,
      start: parsed.start,
      end: parsed.end ?? parsed.start,
      status: parsed.status,
      transparency: parsed.transparency,
      provider: 'apple',
    };
  }

  async deleteEvent(
    userId: string,
    eventId: string,
    calendarId?: string,
  ): Promise<void> {
    const client = await this.clientForUser(userId);
    if (!client) return;
    const objectUrl = decodeAppleObjectId(eventId);
    const found = await this.findObject(client, objectUrl, calendarId);
    if (!found?.object) return;
    await client.deleteCalendarObject({
      calendarObject: {
        url: found.object.url,
        etag: found.object.etag,
      },
    });
  }

  /** Create the named app calendar, or reuse `existingUrl` when iCloud still has it. */
  async ensureNamedCalendar(
    userId: string,
    name: string,
    existingUrl: string | null,
  ): Promise<string> {
    const client = await this.clientForUser(userId);
    if (!client) {
      throw new ServiceUnavailableException('Apple Calendar is not connected.');
    }
    const calendars = await client.fetchCalendars();
    if (existingUrl) {
      const found = (calendars ?? []).find(
        (cal) =>
          cal.url === existingUrl || cal.url === decodeURIComponent(existingUrl),
      );
      if (found?.url) return found.url;
      this.logger.warn(
        'Stored Apple app calendar is missing; creating a new one.',
      );
    }
    const sample = (calendars ?? []).find((cal) => cal.url)?.url;
    if (!sample) {
      throw new ServiceUnavailableException(
        'Apple Calendar did not return a calendar home.',
      );
    }
    const home = sample.replace(/[^/]+\/?$/, '');
    const url = `${home}${randomBytes(8).toString('hex')}/`;
    const writer = client as DavClient & {
      makeCalendar(params: {
        url: string;
        props?: { displayname?: string };
      }): Promise<unknown>;
    };
    await writer.makeCalendar({ url, props: { displayname: name } });
    return url;
  }

  async renameCalendar(
    userId: string,
    calendarUrl: string,
    name: string,
  ): Promise<void> {
    const rows = await this.identities.listForUser(userId);
    const identity = rows.find(
      (row) => row.provider === 'apple' && row.accessToken,
    );
    if (!identity?.email || !identity.accessToken) return;
    const password = identity.accessToken.replace(/[\s-]+/g, '');
    const xml =
      `<?xml version="1.0" encoding="utf-8" ?>` +
      `<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop>` +
      `<d:displayname>${escapeXml(name)}</d:displayname>` +
      `</d:prop></d:set></d:propertyupdate>`;
    const res = await fetch(calendarUrl, {
      method: 'PROPPATCH',
      headers: {
        Authorization: `Basic ${Buffer.from(`${identity.email}:${password}`).toString('base64')}`,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: xml,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ServiceUnavailableException(
        `Apple Calendar could not rename the calendar (${res.status} ${text.slice(0, 180)})`,
      );
    }
  }

  async createAppEvent(
    userId: string,
    calendarUrl: string,
    event: Record<string, unknown>,
  ): Promise<string> {
    const client = await this.clientForUser(userId);
    if (!client) {
      throw new ServiceUnavailableException('Apple Calendar is not connected.');
    }
    const uid = randomUUID();
    const filename = `${uid}.ics`;
    const iCalString = buildVEventIcs(appEventBodyFromGoogle(event), uid);
    const writer = client as DavClient & {
      createCalendarObject(params: {
        calendar: DAVCalendar;
        filename: string;
        iCalString: string;
      }): Promise<unknown>;
    };
    await writer.createCalendarObject({
      calendar: { url: calendarUrl },
      filename,
      iCalString,
    });
    const objectUrl = calendarUrl.endsWith('/')
      ? `${calendarUrl}${filename}`
      : `${calendarUrl}/${filename}`;
    return encodeAppleObjectId(objectUrl);
  }

  private async createClient(
    username: string,
    password: string,
  ): Promise<DavClient> {
    return createDAVClient({
      serverUrl: ICLOUD_CALDAV,
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  }

  private async clientForUser(userId: string): Promise<DavClient | null> {
    const rows = await this.identities.listForUser(userId);
    const identity = rows.find((r) => r.provider === 'apple' && r.accessToken);
    if (!identity?.email || !identity.accessToken) return null;
    // Normalize legacy rows that stored dashes/spaces from the Apple UI copy.
    const password = identity.accessToken.replace(/[\s-]+/g, '');
    return this.createClient(identity.email, password);
  }

  private async findObject(
    client: DavClient,
    objectUrl: string,
    calendarId?: string,
  ): Promise<{ calendar: DAVCalendar; object: DavObject } | null> {
    const calendars = await client.fetchCalendars();
    const list = (calendars ?? []).filter((c) =>
      calendarId
        ? c.url === calendarId || c.url === decodeURIComponent(calendarId)
        : true,
    );
    const fetchOpts = {
      urlFilter: acceptAnyObjectUrl,
      useMultiGet: true as const,
      expand: false as const,
    };
    for (const cal of list) {
      if (!cal.url) continue;
      try {
        const objects = (await client.fetchCalendarObjects({
          calendar: cal,
          objectUrls: [objectUrl],
          ...fetchOpts,
        })) as DavObject[];
        const hit = (objects ?? []).find((o) => o.url === objectUrl);
        if (hit) return { calendar: cal, object: hit };
      } catch {
        // try next calendar
      }
    }
    for (const cal of calendars ?? []) {
      if (!cal.url) continue;
      try {
        const objects = (await client.fetchCalendarObjects({
          calendar: cal,
          ...fetchOpts,
        })) as DavObject[];
        const hit = (objects ?? []).find((o) => o.url === objectUrl);
        if (hit) return { calendar: cal, object: hit };
      } catch {
        // skip
      }
    }
    return null;
  }
}
