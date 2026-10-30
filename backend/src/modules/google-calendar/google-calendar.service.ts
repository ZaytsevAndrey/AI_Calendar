import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { EventPhasesService } from '../event-phases/event-phases.service';
import { PhasesService } from '../phases/phases.service';
import {
  extractPhaseId,
  isMinutesInSleepWindow,
  stripAppManagedEventProperties,
  wallClockMinutesInTimeZone,
} from './google-calendar-event.helpers';
import { displayCalendarIds } from './display-calendar-ids.util';
import { phaseHexToGoogleColorId } from './phase-hex-to-google-color-id.util';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { setRruleUntil } from '../schedule/google-recurrence.util';

type LoginTicket = {
  access_token: string;
  refresh_token: string;
  expiresAt: number;
};

function stubExternalApis(): boolean {
  return process.env.E2E_STUB_EXTERNAL === '1';
}

/**
 * The event does not exist in Google (HTTP 404/410). Only this means "deleted
 * in Google"; every other failure (401/403/429/5xx, timeouts) is a retry.
 */
export class GoogleEventMissingError extends NotFoundException {
  constructor(readonly eventId: string) {
    super(`Google event ${eventId} does not exist`);
  }
}

/** True only for a confirmed missing event: the typed error or a raw 404/410. */
export function isGoogleEventMissing(err: unknown): boolean {
  if (err instanceof GoogleEventMissingError) return true;
  const status = googleErrorStatus(err);
  return status === 404 || status === 410;
}

/** Timeout of each Google API request; below the 2-minute queue leases. */
export const GOOGLE_REQUEST_TIMEOUT_MS = 30_000;

/** HTTP status of a googleapis error, wherever the client put it. */
export function googleErrorStatus(err: unknown): number | null {
  const e = (err ?? {}) as {
    status?: number | string;
    code?: number | string;
    response?: { status?: number | string };
  };
  for (const value of [e.response?.status, e.status, e.code]) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  return null;
}

/** Calendar list changes rarely. Events are reused across the page and voice. */
const CALENDAR_LIST_TTL_MS = 10 * 60_000;
const DISPLAY_EVENTS_TTL_MS = 2 * 60_000;

/** Fields the preview can show. Named once so both list paths stay in sync. */
export const GOOGLE_EVENT_LIST_FIELDS =
  'items(id,summary,description,start,end,location,attendees,recurringEventId,status,colorId,created,updated,htmlLink,hangoutLink,organizer,reminders,visibility,transparency,conferenceData,attachments,source,eventType,workingLocationProperties,outOfOfficeProperties,focusTimeProperties,birthdayProperties),nextPageToken';

type DisplayGoogleEvent = {
  id?: string | null;
  calendarId?: string;
  start?: { dateTime?: string | null; date?: string | null };
  end?: { dateTime?: string | null; date?: string | null };
  [key: string]: unknown;
};

type GoogleEventsApi = {
  events: {
    list: (
      args: Record<string, unknown>,
    ) => Promise<{ data: { items?: DisplayGoogleEvent[]; nextPageToken?: string | null } }>;
  };
};

function googleEventStartMs(event: {
  start?: { dateTime?: string | null; date?: string | null };
}): number {
  const dateTime = event.start?.dateTime;
  if (dateTime) {
    const t = new Date(dateTime).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const date = event.start?.date;
  if (date) {
    const t = new Date(`${date}T00:00:00`).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function googleEventEndMs(event: {
  start?: { dateTime?: string | null; date?: string | null };
  end?: { dateTime?: string | null; date?: string | null };
}): number {
  const dateTime = event.end?.dateTime;
  if (dateTime) {
    const t = new Date(dateTime).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const date = event.end?.date;
  if (date) {
    const t = new Date(`${date}T00:00:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return googleEventStartMs(event);
}

function eventOverlapsWindow(event: DisplayGoogleEvent, startMs: number, endMs: number): boolean {
  return googleEventEndMs(event) > startMs && googleEventStartMs(event) < endMs;
}

/**
 * Event fields this app writes in full on every update (task and reminder
 * payloads): absent from the body means cleared. Everything else on the event
 * is Google's or the user's and is kept (H-3).
 */
const APP_OWNED_EVENT_FIELDS = [
  'summary',
  'description',
  'location',
  'start',
  'end',
  'colorId',
  'visibility',
  'transparency',
  'reminders',
  'recurrence',
] as const;

@Injectable()
export class GoogleCalendarService {
  /**
   * Called after a user's Google grant is stored again (connect / sign-in).
   * `wasDisconnected`: no grant was stored before, so changes made meanwhile
   * were never queued (AUD-013).
   */
  private readonly reconnectListeners: Array<
    (userId: string, opts: { wasDisconnected: boolean }) => void
  > = [];

  /** The write queue revives a reconnected user's waiting and failed writes. */
  onReconnected(listener: (userId: string, opts: { wasDisconnected: boolean }) => void): void {
    this.reconnectListeners.push(listener);
  }

  private notifyReconnected(userId: string, wasDisconnected: boolean): void {
    for (const listener of this.reconnectListeners) {
      try {
        listener(userId, { wasDisconnected });
      } catch (e: unknown) {
        this.logger.warn(`Reconnect listener failed for ${userId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** OAuth app config. Each call builds its own client: credentials are per user. */
  private readonly oauthConfig: [string | undefined, string | undefined, string];
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly loginTickets = new Map<string, LoginTicket>();
  private readonly calendarListCache = new Map<
    string,
    { at: number; items: Array<{ id?: string | null; primary?: boolean | null; selected?: boolean | null; accessRole?: string | null }> }
  >();
  private readonly displayEventsCache = new Map<
    string,
    { at: number; startMs: number; endMs: number; events: DisplayGoogleEvent[] }
  >();
  private readonly displayEventsInflight = new Map<
    string,
    { startMs: number; endMs: number; pending: Promise<{ events: DisplayGoogleEvent[]; totalEvents: number }> }
  >();

  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserSettings)
    private userSettingsRepo: Repository<UserSettings>,
    private eventPhasesService: EventPhasesService,
    private readonly phasesService: PhasesService,
    private readonly jwtService: JwtService,
  ) {
    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get('GOOGLE_CLIENT_SECRET');
    const redirectUri =
      this.configService.get('GOOGLE_REDIRECT_URI') ||
      'http://localhost:3001/google-calendar/callback';

    this.logger.log(`Initializing Google OAuth2 with:`);
    this.logger.log(`Client ID: ${clientId ? 'SET' : 'NOT SET'}`);
    this.logger.log(`Client Secret: ${clientSecret ? 'SET' : 'NOT SET'}`);
    this.logger.log(`Redirect URI: ${redirectUri}`);

    // Every Google API call ends well inside the queue leases (2 min):
    // a hung request cannot hold a worker indefinitely (AUD-007).
    google.options({ timeout: GOOGLE_REQUEST_TIMEOUT_MS });

    this.oauthConfig = [
      clientId,
      clientSecret,
      redirectUri,
    ];
  }

  /**
   * A fresh client per call. One shared client let a concurrent call for
   * another user swap its credentials before the request (or token refresh)
   * ran. Loosely typed like the old shared field.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private newOAuthClient(): any {
    return new google.auth.OAuth2(...this.oauthConfig);
  }

  getLoginAuthUrl() {
    const oauth = this.newOAuthClient();
    if (stubExternalApis()) {
      return 'https://accounts.google.com/o/oauth2/v2/auth?e2e=1';
    }
    const scopes = [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    const authUrl = oauth.generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'select_account',
      scope: scopes,
    });

    this.logger.log('Generated Google sign-in URL');
    return authUrl;
  }

  /** @deprecated Use getLoginAuthUrl; kept for config diagnostics. */
  getAuthUrl(_userId?: string) {
    return this.getLoginAuthUrl();
  }

  async completeGoogleSignIn(code: string): Promise<string> {
    const oauth = this.newOAuthClient();
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);

    let googleId: string | undefined;
    let email: string | undefined;
    try {
      const oauth2 = google.oauth2({
        version: 'v2',
        auth: oauth,
      });
      const { data: profile } = await oauth2.userinfo.get();
      googleId = profile.id ?? undefined;
      email = profile.email ?? undefined;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Google userinfo failed, falling back to id_token: ${msg}`);
    }

    if ((!googleId || !email) && tokens.id_token) {
      const fromId = this.parseGoogleIdToken(tokens.id_token);
      googleId = googleId ?? fromId.sub;
      email = email ?? fromId.email;
    }

    email = (email ?? '').trim().toLowerCase();
    if (!googleId || !email) {
      throw new BadRequestException(
        'Google did not return an email address for this account.',
      );
    }

    const user = await this.findOrLinkGoogleUser(googleId, email);
    if (user.isBlocked) {
      throw new BadRequestException('This account is blocked.');
    }
    await this.persistGoogleTokens(user.id, tokens);
    await this.ensureSettingsLinked(user.id);

    try {
      const cal = google.calendar({
        version: 'v3',
        auth: oauth,
      });
      await this.ensureAppCalendarIdWithClient(cal, user.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Could not ensure app Google Calendar after sign-in: ${msg}`,
      );
    }

    const pair = this.createAppTokenPair(user.id);
    await this.userRepo.update({ id: user.id }, { refreshToken: pair.refresh_token });
    return this.issueLoginTicket(pair);
  }

  redeemLoginTicket(ticket: string): {
    access_token: string;
    refresh_token: string;
  } {
    const row = this.loginTickets.get(ticket);
    this.loginTickets.delete(ticket);
    if (!row || row.expiresAt < Date.now()) {
      throw new UnauthorizedException('Sign-in session expired. Try again.');
    }
    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
    };
  }

  private parseGoogleIdToken(idToken: string): {
    sub?: string;
    email?: string;
  } {
    try {
      const payload = idToken.split('.')[1];
      if (!payload) return {};
      const json = Buffer.from(payload, 'base64url').toString('utf8');
      const parsed = JSON.parse(json) as { sub?: string; email?: string };
      return { sub: parsed.sub, email: parsed.email };
    } catch {
      return {};
    }
  }

  private createAppTokenPair(userId: string): {
    access_token: string;
    refresh_token: string;
  } {
    const payload = { sub: userId };
    return {
      access_token: this.jwtService.sign(payload, { expiresIn: '15m' }),
      refresh_token: this.jwtService.sign(payload, { expiresIn: '7d' }),
    };
  }

  private issueLoginTicket(pair: {
    access_token: string;
    refresh_token: string;
  }): string {
    const ticket = randomBytes(24).toString('hex');
    this.loginTickets.set(ticket, {
      ...pair,
      expiresAt: Date.now() + 120_000,
    });
    return ticket;
  }

  private async findOrLinkGoogleUser(
    googleId: string,
    email: string,
  ): Promise<User> {
    const byGoogleId = await this.userRepo.findOne({ where: { googleId } });
    if (byGoogleId) return byGoogleId;

    const byEmail = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (byEmail) {
      await this.userRepo.update({ id: byEmail.id }, { googleId });
      this.logger.log(
        `Linked Google account ${googleId} to existing user ${byEmail.id}`,
      );
      return { ...byEmail, googleId };
    }

    const placeholderPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const created = this.userRepo.create({
      email,
      googleId,
      password: placeholderPassword,
      isEmailVerified: true,
    });
    const saved = await this.userRepo.save(created);
    this.logger.log(`Created user ${saved.id} from Google sign-in`);
    return saved;
  }

  private async persistGoogleTokens(
    userId: string,
    tokens: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
    },
  ): Promise<void> {
    const existing = await this.userRepo.findOne({
      where: { id: userId },
      select: { googleAccessToken: true, googleRefreshToken: true },
    });
    const refreshToken = tokens.refresh_token ?? existing?.googleRefreshToken ?? null;
    await this.userRepo.update(userId, {
      googleAccessToken: tokens.access_token ?? existing?.googleAccessToken ?? null,
      googleRefreshToken: refreshToken,
      googleTokenExpiry: new Date(
        tokens.expiry_date ?? Date.now() + 3_600_000,
      ),
    });
    if (!refreshToken) {
      // Google sends a refresh token only with consent; without one the
      // grant ends with this access token (about an hour).
      this.logger.warn(`Google returned no refresh token for user ${userId}; calendar sync stops when the access token expires`);
    }
    this.notifyReconnected(
      userId,
      !existing?.googleAccessToken && !existing?.googleRefreshToken,
    );
  }

  private async ensureSettingsLinked(userId: string): Promise<void> {
    const settings = await this.userSettingsRepo.findOne({ where: { userId } });
    if (settings) {
      await this.userSettingsRepo.update({ userId }, { googleCalendarLinked: true });
      return;
    }
    await this.userSettingsRepo.save(
      this.userSettingsRepo.create({
        userId,
        googleCalendarLinked: true,
        wakeTime: '07:00',
        sleepTime: '22:00',
        defaultWorkBlockDuration: 25,
        defaultBreakDuration: 5,
        defaultLunchDuration: 60,
        preferredLunchTime: '12:00',
        weekendWorkEnabled: false,
        allowSplitScheduling: true,
        fixedEventBufferMinutes: 0,
        minSplitMinutes: 30,
        maxSplitMinutes: 30,
        recurringScheduleHorizonDays: 30,
        appGoogleCalendarName: 'luefy',
      }),
    );
  }

  async saveToken(code: string, userId?: string) {
    const oauth = this.newOAuthClient();
    this.logger.log(
      `Attempting to save token with code: ${code.substring(0, 10)}...`,
    );

    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const { tokens } = await oauth.getToken(code);
      this.logger.log(`Successfully obtained tokens from Google`);

      const user = await this.userRepo.findOne({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      this.logger.log(`Updating user ${user.id} with Google tokens`);
      await this.userRepo.update(user.id, {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        googleTokenExpiry: new Date(
          tokens.expiry_date ?? Date.now() + 3_600_000,
        ),
      });

      await this.userSettingsRepo.update(
        { userId: user.id },
        { googleCalendarLinked: true },
      );

      this.logger.log(`Successfully saved Google tokens for user ${user.id}`);
      this.notifyReconnected(
        user.id,
        !user.googleAccessToken && !user.googleRefreshToken,
      );

      try {
        oauth.setCredentials({
          access_token: tokens.access_token,
        });
        const cal = google.calendar({
          version: 'v3',
          auth: oauth,
        });
        await this.ensureAppCalendarIdWithClient(cal, user.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Could not ensure app Google Calendar after link: ${msg}`);
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Error saving Google token: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      throw error;
    }
  }

  async checkConnection(userId: string) {
    const oauth = this.newOAuthClient();
    if (stubExternalApis()) {
      return { connected: false };
    }
    this.logger.log(`Checking connection for user: ${userId}`);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    this.logger.log(
      `User found: ${!!user}, Has access token: ${!!user?.googleAccessToken}`,
    );

    if (!user?.googleAccessToken) {
      this.logger.log(`No access token found for user ${userId}`);
      return { connected: false };
    }

    // Check token expiry
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        try {
          oauth.setCredentials({
            refresh_token: user.googleRefreshToken,
          });
          const { credentials } = await oauth.refreshAccessToken();
          await this.userRepo.update(userId, {
            googleAccessToken: credentials.access_token,
            googleTokenExpiry: new Date(credentials.expiry_date),
          });
        } catch (error) {
          return { connected: false };
        }
      } else {
        return { connected: false };
      }
    }

    this.logger.log(`Connection confirmed for user ${userId}`);
    return { connected: true };
  }

  /** Returns persisted app calendar id without creating or calling Google. */
  async getStoredAppCalendarId(userId: string): Promise<string | null> {
    const s = await this.userSettingsRepo.findOne({
      where: { userId },
      select: { appGoogleCalendarId: true },
    });
    return s?.appGoogleCalendarId ?? null;
  }

  /**
   * Creates the user's app-managed secondary calendar if missing, updates settings, and returns its id.
   * Caller must have set OAuth credentials on `oauth`.
   */
  private async ensureAppCalendarIdWithClient(
    calendar: ReturnType<typeof google.calendar>,
    userId: string,
  ): Promise<string> {
    const settings = await this.userSettingsRepo.findOne({ where: { userId } });
    const name =
      (settings?.appGoogleCalendarName ?? '').trim() || 'luefy';
    const existing = settings?.appGoogleCalendarId;
    if (existing) {
      try {
        await calendar.calendars.get({ calendarId: existing });
        return existing;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Stored app calendar missing or inaccessible (${msg}); creating a new one.`,
        );
      }
    }
    const res = await calendar.calendars.insert({
      requestBody: { summary: name },
    });
    const id = res.data.id;
    if (!id) {
      throw new ServiceUnavailableException(
        'Google Calendar did not return a calendar id.',
      );
    }
    await this.userSettingsRepo.update({ userId }, { appGoogleCalendarId: id });
    this.calendarListCache.delete(userId);
    return id;
  }

  /** Updates the Google calendar title when the user renames it in settings (calendar must already exist). */
  async updateAppCalendarSummaryIfLinked(userId: string): Promise<void> {
    const oauth = this.newOAuthClient();
    const settings = await this.userSettingsRepo.findOne({ where: { userId } });
    if (!settings?.appGoogleCalendarId) return;

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });
    if (!user?.googleAccessToken) return;

    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (!user.googleRefreshToken) return;
      oauth.setCredentials({
        refresh_token: user.googleRefreshToken,
      });
      const { credentials } = await oauth.refreshAccessToken();
      await this.userRepo.update(userId, {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(
          credentials.expiry_date ?? Date.now() + 3_600_000,
        ),
      });
      user.googleAccessToken = credentials.access_token;
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });
    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });
    const summary =
      (settings.appGoogleCalendarName ?? '').trim() || 'luefy';
    await calendar.calendars.patch({
      calendarId: settings.appGoogleCalendarId,
      requestBody: { summary },
    });
  }

  private async applyPhaseColorToRequestBody(
    userId: string,
    phaseId: string | undefined,
    requestBody: Record<string, unknown>,
  ): Promise<void> {
    if (!phaseId) return;
    const phase = await this.phasesService.findOne(phaseId, userId);
    const cid = phaseHexToGoogleColorId(phase.color);
    if (cid) {
      requestBody.colorId = cid;
    }
  }

  async checkAllUsersWithTokens() {
    const users = await this.userRepo.find({
      select: {
        id: true,
        email: true,
        googleAccessToken: true,
      },
    });

    const usersWithTokens = users.filter((user) => user.googleAccessToken);
    this.logger.log(`Users with Google tokens: ${usersWithTokens.length}`);
    usersWithTokens.forEach((user) => {
      this.logger.log(`User ${user.email} (${user.id}) has token`);
    });

    return usersWithTokens;
  }

  async disconnectCalendar(userId: string) {
    this.logger.log(`Disconnecting Google Calendar for user: ${userId}`);

    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // AUD-013: revoke the grant at Google too. Otherwise the next sign-in
      // (prompt: select_account, no consent) returns no refresh token and
      // sync silently stops an hour after reconnecting. Best effort.
      const grant = user.googleRefreshToken ?? user.googleAccessToken;
      if (grant && !stubExternalApis()) {
        try {
          await this.newOAuthClient().revokeToken(grant);
        } catch (e: unknown) {
          this.logger.warn(`Could not revoke the Google grant of user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Clear tokens
      await this.userRepo.update(userId, {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
      });

      // Update connection status
      await this.userSettingsRepo.update(
        { userId: user.id },
        { googleCalendarLinked: false },
      );

      this.forgetGoogleDisplayCache(userId);
      this.logger.log(
        `Successfully disconnected Google Calendar for user ${userId}`,
      );
      return {
        success: true,
        message: 'Google Calendar disconnected successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error disconnecting Google Calendar: ${error.message}`,
      );
      throw error;
    }
  }

  async getEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
    maxResults: number = 100,
    pageToken?: string,
    calendarId?: string,
  ) {
    const oauth = this.newOAuthClient();
    if (stubExternalApis()) {
      return { events: [], totalEvents: 0 };
    }
    this.logger.log(
      `Fetching events for user ${userId} from ${timeMin} to ${timeMax}`,
    );

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }

    // Refresh token when needed
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
        this.logger.log(`Token refreshed successfully for user ${userId}`);
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    let calId = calendarId;
    if (calId === undefined || calId === '') {
      calId =
        (await this.getStoredAppCalendarId(userId)) ?? 'primary';
    }

    try {
      const response = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        maxResults,
        pageToken,
        singleEvents: true,
        orderBy: 'startTime',
        fields: GOOGLE_EVENT_LIST_FIELDS,
      });

      this.logger.log(
        `Successfully fetched ${response.data.items?.length || 0} events for user ${userId}`,
      );

      return {
        events: response.data.items || [],
        nextPageToken: response.data.nextPageToken,
        totalEvents: response.data.items?.length || 0,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching events for user ${userId}: ${error.message}`,
      );
      throw new Error(`Failed to fetch calendar events: ${error.message}`);
    }
  }

  /**
   * Events for the Calendar UI: primary + app calendar + other selected Google calendars.
   * Single-calendar getEvents() stays app-calendar-only so Clear schedule does not wipe primary.
   */
  async getDisplayEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
    maxResults: number = 250,
  ) {
    if (stubExternalApis()) {
      return { events: [], totalEvents: 0 };
    }
    const startMs = new Date(timeMin).getTime();
    const endMs = new Date(timeMax).getTime();
    const cached = this.displayEventsFromCache(userId, startMs, endMs);
    if (cached) return { events: cached, totalEvents: cached.length };

    const covering = this.coveringDisplayFetch(userId, startMs, endMs);
    if (covering) {
      const loaded = await covering;
      const events = loaded.events.filter((event) => eventOverlapsWindow(event, startMs, endMs));
      return { events, totalEvents: events.length };
    }

    const key = `${userId}|${timeMin}|${timeMax}`;
    const pending = this.loadDisplayEvents(userId, timeMin, timeMax, startMs, endMs, maxResults);
    this.displayEventsInflight.set(key, { startMs, endMs, pending });
    try {
      return await pending;
    } finally {
      this.displayEventsInflight.delete(key);
    }
  }

  private displayEventsFromCache(
    userId: string,
    startMs: number,
    endMs: number,
  ): DisplayGoogleEvent[] | null {
    const now = Date.now();
    for (const [key, entry] of this.displayEventsCache) {
      if (!key.startsWith(`${userId}|`)) continue;
      if (now - entry.at >= DISPLAY_EVENTS_TTL_MS) continue;
      if (entry.startMs <= startMs && entry.endMs >= endMs) {
        return entry.events.filter((event) => eventOverlapsWindow(event, startMs, endMs));
      }
    }
    return null;
  }

  private coveringDisplayFetch(
    userId: string,
    startMs: number,
    endMs: number,
  ): Promise<{ events: DisplayGoogleEvent[]; totalEvents: number }> | null {
    for (const [key, entry] of this.displayEventsInflight) {
      if (!key.startsWith(`${userId}|`)) continue;
      if (entry.startMs <= startMs && entry.endMs >= endMs) return entry.pending;
    }
    return null;
  }

  private async loadDisplayEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
    startMs: number,
    endMs: number,
    maxResults: number,
  ): Promise<{ events: DisplayGoogleEvent[]; totalEvents: number }> {
    const calendarIds = await this.listDisplayCalendarIds(userId);
    const appId = await this.getStoredAppCalendarId(userId);
    let calendar: GoogleEventsApi;
    try {
      calendar = (await this.authorizedCalendar(userId)) as unknown as GoogleEventsApi;
    } catch (error) {
      this.logger.warn(
        `Skip Google display events: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { events: [], totalEvents: 0 };
    }

    const chunks = await Promise.all(
      calendarIds.map(async (calendarId) => {
        try {
          const pages = await this.listCalendarEventPages(
            calendar,
            calendarId,
            timeMin,
            timeMax,
            maxResults,
          );
          return pages.map((event) => ({
            ...event,
            calendarId,
            isAppGenerated: Boolean(appId && calendarId === appId),
          }));
        } catch (error) {
          this.logger.warn(
            `Skip calendar ${calendarId} for display: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [] as DisplayGoogleEvent[];
        }
      }),
    );

    const seen = new Set<string>();
    const events: DisplayGoogleEvent[] = [];
    for (const chunk of chunks) {
      for (const event of chunk) {
        if (!event?.id) continue;
        const key = `${event.calendarId}:${event.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(event);
      }
    }
    events.sort((a, b) => googleEventStartMs(a) - googleEventStartMs(b));
    this.displayEventsCache.set(`${userId}|${startMs}|${endMs}`, {
      at: Date.now(),
      startMs,
      endMs,
      events,
    });
    return { events, totalEvents: events.length };
  }

  private async listCalendarEventPages(
    calendar: GoogleEventsApi,
    calendarId: string,
    timeMin: string,
    timeMax: string,
    maxResults: number,
  ): Promise<DisplayGoogleEvent[]> {
    const events: DisplayGoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const response = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        pageToken,
        singleEvents: true,
        orderBy: 'startTime',
        fields: GOOGLE_EVENT_LIST_FIELDS,
      });
      events.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return events;
  }

  /** One auth setup, then every visible calendar is listed at once. */
  private async authorizedCalendar(userId: string) {
    const oauth = this.newOAuthClient();
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });
    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (!user.googleRefreshToken) {
        throw new Error('Google Calendar token expired');
      }
      oauth.setCredentials({
        refresh_token: user.googleRefreshToken,
      });
      const { credentials } = await oauth.refreshAccessToken();
      await this.userRepo.update(userId, {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(credentials.expiry_date),
      });
      user.googleAccessToken = credentials.access_token;
    }
    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });
    return google.calendar({
      version: 'v3',
      auth: oauth,
    });
  }

  private forgetGoogleDisplayCache(userId: string): void {
    this.calendarListCache.delete(userId);
    const prefix = `${userId}|`;
    for (const key of this.displayEventsCache.keys()) {
      if (key.startsWith(prefix)) this.displayEventsCache.delete(key);
    }
  }

  private async listDisplayCalendarIds(userId: string): Promise<string[]> {
    const settings = await this.userSettingsRepo.findOne({
      where: { userId },
    });
    const hiddenIds = Array.isArray(settings?.hiddenGoogleCalendarIds)
      ? settings.hiddenGoogleCalendarIds
      : [];
    const appCalendarId = settings?.appGoogleCalendarId ?? null;

    try {
      const items = await this.cachedCalendarList(userId);
      return displayCalendarIds({ items, hiddenIds, appCalendarId });
    } catch (error) {
      this.logger.warn(
        `Could not list Google calendars for display; using primary/app only: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return displayCalendarIds({
        items: [],
        hiddenIds,
        appCalendarId,
        listFailed: true,
      });
    }
  }

  private async cachedCalendarList(userId: string) {
    const hit = this.calendarListCache.get(userId);
    if (hit && Date.now() - hit.at < CALENDAR_LIST_TTL_MS) return hit.items;
    const items = await this.getCalendars(userId);
    this.calendarListCache.set(userId, { at: Date.now(), items });
    return items;
  }

  async getEvent(
    userId: string,
    eventId: string,
    calendarId?: string,
  ) {
    const oauth = this.newOAuthClient();
    this.logger.log(`Fetching event ${eventId} for user ${userId}`);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }

    // Refresh token when needed
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    let calId = calendarId;
    if (calId === undefined || calId === '') {
      calId =
        (await this.getStoredAppCalendarId(userId)) ?? 'primary';
    }

    try {
      const response = await calendar.events.get({
        calendarId: calId,
        eventId,
      });

      this.logger.log(
        `Successfully fetched event ${eventId} for user ${userId}`,
      );
      // H-2: a deleted event can still be read, as `cancelled`: it is gone.
      if (response.data.status === 'cancelled') throw new GoogleEventMissingError(eventId);
      // Include phaseId in the response when linked
      const eventData = response.data;
      if (eventId && userId) {
        const eventPhase = await this.eventPhasesService.findByEvent(String(eventId), String(userId));
        if (eventPhase) {
          (eventData as any).phaseId = eventPhase.phaseId;
        }
      }
      return eventData;
    } catch (error) {
      this.logger.error(
        `Error fetching event ${eventId} for user ${userId}: ${error.message}`,
      );
      if (this.isGoogleNotFound(error)) throw new GoogleEventMissingError(eventId);
      // Keep the HTTP status: callers must not read a 503 as "deleted".
      throw Object.assign(new Error(`Failed to fetch event: ${error.message}`), {
        status: googleErrorStatus(error),
      });
    }
  }

  /**
   * Keep past instances of a Google series: patch RRULE UNTIL, do not change DTSTART.
   */
  async capRecurringSeriesUntil(
    userId: string,
    eventId: string,
    until: Date,
    calendarId?: string,
  ): Promise<void> {
    const oauth = this.newOAuthClient();
    const existing = await this.getEvent(userId, eventId, calendarId);
    const recurrence = Array.isArray(existing?.recurrence)
      ? [...existing.recurrence]
      : [];
    const rruleIdx = recurrence.findIndex((line) =>
      String(line).toUpperCase().startsWith('RRULE:'),
    );
    if (rruleIdx < 0) {
      this.logger.warn(
        `Cannot cap series ${eventId}: no RRULE on the master event.`,
      );
      return;
    }
    recurrence[rruleIdx] = setRruleUntil(String(recurrence[rruleIdx]), until);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });
    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (!user.googleRefreshToken) {
        throw new Error('Google Calendar token expired');
      }
      oauth.setCredentials({
        refresh_token: user.googleRefreshToken,
      });
      const { credentials } = await oauth.refreshAccessToken();
      await this.userRepo.update(userId, {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(credentials.expiry_date),
      });
      user.googleAccessToken = credentials.access_token;
    }
    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });
    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });
    const calId =
      calendarId && calendarId !== ''
        ? calendarId
        : (await this.getStoredAppCalendarId(userId)) ?? 'primary';
    await calendar.events.patch({
      calendarId: calId,
      eventId,
      requestBody: { recurrence },
    });
  }

  async getCalendars(userId: string) {
    const oauth = this.newOAuthClient();
    this.logger.log(`Fetching calendars for user ${userId}`);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }

    // Refresh token when needed
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    try {
      const response = await calendar.calendarList.list({
        fields:
          'items(id,summary,description,primary,selected,accessRole,backgroundColor,foregroundColor)',
      });

      this.logger.log(
        `Successfully fetched ${response.data.items?.length || 0} calendars for user ${userId}`,
      );
      return response.data.items || [];
    } catch (error) {
      this.logger.error(
        `Error fetching calendars for user ${userId}: ${error.message}`,
      );
      throw new Error(`Failed to fetch calendars: ${error.message}`);
    }
  }

  private async assertCalendarWritePayload(
    userId: string,
    body: Record<string, unknown>,
    opts?: { skipSleepWindowCheck?: boolean },
  ): Promise<{ phaseId?: string }> {
    const phaseId = extractPhaseId(body);
    if (phaseId) {
      await this.phasesService.findOne(phaseId, userId);
    }

    const start = body.start as
      | { dateTime?: string; date?: string; timeZone?: string }
      | undefined;
    const end = body.end as
      | { dateTime?: string; date?: string; timeZone?: string }
      | undefined;

    if (start?.dateTime && end?.dateTime) {
      const startMs = new Date(start.dateTime).getTime();
      const endMs = new Date(end.dateTime).getTime();
      if (!(endMs > startMs)) {
        throw new BadRequestException('Event end must be after start.');
      }
      if (!opts?.skipSleepWindowCheck) {
        const settings = await this.userSettingsRepo.findOne({
          where: { userId },
        });
        if (settings?.wakeTime && settings?.sleepTime) {
          const tz = resolveIanaTimeZone(
            settings.timeZone || start.timeZone || end.timeZone,
          );
          const startM = wallClockMinutesInTimeZone(start.dateTime, tz);
          const endM = wallClockMinutesInTimeZone(end.dateTime, tz);
          if (
            isMinutesInSleepWindow(startM, settings.sleepTime, settings.wakeTime) ||
            isMinutesInSleepWindow(endM, settings.sleepTime, settings.wakeTime)
          ) {
            throw new BadRequestException(
              'Events cannot be scheduled during sleep time.',
            );
          }
        }
      }
    }

    return { phaseId };
  }

  async createEvent(
    userId: string,
    event: Record<string, unknown>,
    opts?: { skipSleepWindowCheck?: boolean; calendarId?: string },
  ) {
    const oauth = this.newOAuthClient();
    const { phaseId } = await this.assertCalendarWritePayload(
      userId,
      event,
      opts,
    );
    const requestBody = stripAppManagedEventProperties(event);
    await this.applyPhaseColorToRequestBody(userId, phaseId, requestBody);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new BadRequestException('Google Calendar is not connected.');
    }

    // Refresh token when needed
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new BadRequestException('Google Calendar token expired.');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    const writableCalendarId = await this.ensureAppCalendarIdWithClient(
      calendar,
      userId,
    );

    let response;
    try {
      response = await calendar.events.insert({
        calendarId: writableCalendarId,
        requestBody,
      });
    } catch (err: unknown) {
      // Our own id already exists: an earlier insert whose answer was lost
      // (timeout) did create it. Return that event instead of a second one.
      const ownId = typeof requestBody.id === 'string' ? requestBody.id : null;
      if (ownId && googleErrorStatus(err) === 409) {
        response = await calendar.events.get({
          calendarId: writableCalendarId,
          eventId: ownId,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Google Calendar insert failed: ${msg}`);
        throw new ServiceUnavailableException(
          'Google Calendar could not create the event.',
        );
      }
    }

    if (
      phaseId &&
      typeof response.data.id === 'string' &&
      // A recovered insert (409) may already have its phase link.
      !(await this.eventPhasesService.findByEvent(response.data.id, String(userId)))
    ) {
      await this.eventPhasesService.create(
        response.data.id,
        phaseId,
        String(userId),
      );
    }

    this.forgetGoogleDisplayCache(userId);
    return {
      ...response.data,
      appCalendarId: writableCalendarId,
    };
  }

  /**
   * Replace the event with `event` (H-2 / H-3). PUT replaces the whole event,
   * so it starts from the event as Google holds it: what this app does not
   * manage (guests, conferencing, attachments…) survives, and the fields it
   * owns (`APP_OWNED_EVENT_FIELDS`) are replaced — cleared when absent from
   * `event` — unless `partial` (an edit of some fields only). A deleted event
   * reads back as `cancelled`: reported missing, never restored. One extra
   * read per update.
   */
  async updateEvent(
    userId: string,
    eventId: string,
    event: Record<string, unknown>,
    opts?: { skipSleepWindowCheck?: boolean; calendarId?: string; partial?: boolean },
  ) {
    const oauth = this.newOAuthClient();
    const { phaseId } = await this.assertCalendarWritePayload(
      userId,
      event,
      opts,
    );
    const requestBody = stripAppManagedEventProperties(event);
    await this.applyPhaseColorToRequestBody(userId, phaseId, requestBody);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new BadRequestException('Google Calendar is not connected.');
    }

    // Refresh token when needed
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new BadRequestException('Google Calendar token expired.');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    const writableCalendarId =
      opts?.calendarId != null && opts.calendarId !== ''
        ? opts.calendarId
        : await this.ensureAppCalendarIdWithClient(calendar, userId);

    let response;
    try {
      const { data: current } = await calendar.events.get({
        calendarId: writableCalendarId,
        eventId,
      });
      if (current.status === 'cancelled') throw new GoogleEventMissingError(eventId);
      const merged: Record<string, unknown> = { ...current };
      if (!opts?.partial) {
        for (const key of APP_OWNED_EVENT_FIELDS) delete merged[key];
      }
      Object.assign(merged, requestBody);
      response = await calendar.events.update({
        calendarId: writableCalendarId,
        eventId,
        requestBody: merged,
        // Without it Google ignores conference data in the body.
        ...(merged.conferenceData ? { conferenceDataVersion: 1 } : {}),
      });
    } catch (err: unknown) {
      if (err instanceof GoogleEventMissingError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Google Calendar update failed: ${msg}`);
      if (this.isGoogleNotFound(err)) throw new GoogleEventMissingError(eventId);
      throw new ServiceUnavailableException(
        'Google Calendar could not update the event.',
      );
    }

    if (phaseId) {
      const existing = await this.eventPhasesService.findByEvent(
        eventId,
        String(userId),
      );
      if (existing) {
        await this.eventPhasesService.update(
          existing.id,
          String(userId),
          phaseId,
        );
      } else {
        await this.eventPhasesService.create(eventId, phaseId, String(userId));
      }
    } else {
      const existing = await this.eventPhasesService.findByEvent(
        eventId,
        String(userId),
      );
      if (existing) {
        await this.eventPhasesService.remove(existing.id, String(userId));
      }
    }

    this.forgetGoogleDisplayCache(userId);
    return {
      ...response.data,
      appCalendarId: writableCalendarId,
    };
  }

  /** Change only start/end so a drag does not replace the rest of the event. */
  async patchEventTimes(
    userId: string,
    eventId: string,
    startIso: string,
    endIso: string,
    calendarId?: string,
  ): Promise<void> {
    const oauth = this.newOAuthClient();
    const body = {
      start: { dateTime: startIso },
      end: { dateTime: endIso },
    };
    await this.assertCalendarWritePayload(userId, body, {
      skipSleepWindowCheck: true,
    });

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new BadRequestException('Google Calendar is not connected.');
    }

    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new BadRequestException('Google Calendar token expired.');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });
    const writableCalendarId =
      calendarId != null && calendarId !== ''
        ? calendarId
        : await this.ensureAppCalendarIdWithClient(calendar, userId);

    try {
      await calendar.events.patch({
        calendarId: writableCalendarId,
        eventId,
        requestBody: body,
      });
      this.forgetGoogleDisplayCache(userId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Google Calendar time patch failed: ${msg}`);
      throw new ServiceUnavailableException(
        'Google Calendar could not update the event.',
      );
    }
  }

  /** Already gone / never existed — treat delete as success (local cleanup only). */
  private isGoogleNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as {
      code?: number | string;
      status?: number | string;
      message?: string;
      errors?: Array<{ reason?: string; message?: string }>;
      response?: {
        status?: number | string;
        data?: {
          error?: {
            code?: number | string;
            message?: string;
            errors?: Array<{ reason?: string; message?: string }>;
          };
        };
      };
    };
    const statuses = [e.status, e.code, e.response?.status, e.response?.data?.error?.code];
    if (statuses.some((s) => s === 404 || s === '404' || s === 410 || s === '410')) {
      return true;
    }
    const reasons = [
      ...(e.errors ?? []),
      ...(e.response?.data?.error?.errors ?? []),
    ]
      .map((x) => x?.reason)
      .filter(Boolean);
    if (reasons.some((r) => r === 'notFound' || r === 'deleted')) {
      return true;
    }
    const message = [
      e.message,
      e.response?.data?.error?.message,
      ...(e.errors ?? []).map((x) => x?.message),
      ...(e.response?.data?.error?.errors ?? []).map((x) => x?.message),
    ]
      .filter(Boolean)
      .join(' ');
    return /not\s*found|has been deleted|\bgone\b/i.test(message);
  }

  /**
   * Deletes the dedicated app secondary calendar (and its events) when present.
   * No-op when disconnected or the calendar id is missing. Not-found is success.
   */
  async deleteAppCalendar(userId: string): Promise<void> {
    const oauth = this.newOAuthClient();
    if (stubExternalApis()) return;

    const settings = await this.userSettingsRepo.findOne({ where: { userId } });
    const calendarId = settings?.appGoogleCalendarId?.trim();
    if (!calendarId) return;

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });
    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }

    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (!user.googleRefreshToken) {
        throw new Error('Google Calendar token expired');
      }
      oauth.setCredentials({
        refresh_token: user.googleRefreshToken,
      });
      const { credentials } = await oauth.refreshAccessToken();
      await this.userRepo.update(userId, {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(credentials.expiry_date),
      });
      user.googleAccessToken = credentials.access_token;
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });
    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    try {
      await calendar.calendars.delete({ calendarId });
    } catch (e: unknown) {
      if (!this.isGoogleNotFound(e)) throw e;
      this.logger.warn(
        `App calendar ${calendarId} already gone for user ${userId}`,
      );
    }

    await this.userSettingsRepo.update(
      { userId },
      { appGoogleCalendarId: null },
    );
    this.forgetGoogleDisplayCache(userId);
  }

  async deleteEvent(userId: string, eventId: string, calendarId?: string) {
    const oauth = this.newOAuthClient();
    if (stubExternalApis()) {
      return { success: true };
    }

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiry: true,
      },
    });

    if (!user?.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }

    // Refresh token when needed
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      if (user.googleRefreshToken) {
        oauth.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await oauth.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    oauth.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth,
    });

    const storedApp = await this.getStoredAppCalendarId(userId);
    const calendarIds: string[] = [];
    const pushId = (id?: string | null) => {
      if (id && !calendarIds.includes(id)) calendarIds.push(id);
    };
    // Prefer the known calendar, then fall back — a stale calendarId must not
    // surface as a hard error when the event is already gone elsewhere.
    pushId(calendarId);
    pushId(storedApp);
    if (!calendarIds.length) {
      pushId(await this.ensureAppCalendarIdWithClient(calendar, userId));
    }
    pushId('primary');

    let deleted = false;
    for (const calId of calendarIds) {
      try {
        await calendar.events.delete({
          calendarId: calId,
          eventId,
        });
        deleted = true;
        break;
      } catch (e: unknown) {
        if (!this.isGoogleNotFound(e)) throw e;
      }
    }

    if (!deleted) {
      this.logger.warn(
        `Google event ${eventId} not found on calendars [${calendarIds.join(', ')}]; treating as already deleted.`,
      );
    }

    const link = await this.eventPhasesService.findByEvent(
      eventId,
      String(userId),
    );
    if (link) {
      await this.eventPhasesService.remove(link.id, String(userId));
    }

    this.forgetGoogleDisplayCache(userId);
    return { success: true };
  }
}
