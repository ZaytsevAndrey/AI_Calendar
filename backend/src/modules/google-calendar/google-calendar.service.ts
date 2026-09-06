import {
  BadRequestException,
  Injectable,
  Logger,
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
import { phaseHexToGoogleColorId } from './phase-hex-to-google-color-id.util';

type LoginTicket = {
  access_token: string;
  refresh_token: string;
  expiresAt: number;
};

@Injectable()
export class GoogleCalendarService {
  private oauth2Client;
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly loginTickets = new Map<string, LoginTicket>();

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

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri,
    );
  }

  getLoginAuthUrl() {
    const scopes = [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    const authUrl = this.oauth2Client.generateAuthUrl({
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
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    let googleId: string | undefined;
    let email: string | undefined;
    try {
      const oauth2 = google.oauth2({
        version: 'v2',
        auth: this.oauth2Client,
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
    await this.persistGoogleTokens(user.id, tokens);
    await this.ensureSettingsLinked(user.id);

    try {
      const cal = google.calendar({
        version: 'v3',
        auth: this.oauth2Client,
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
      select: { googleRefreshToken: true },
    });
    await this.userRepo.update(userId, {
      googleAccessToken: tokens.access_token ?? existing?.googleAccessToken ?? null,
      googleRefreshToken:
        tokens.refresh_token ?? existing?.googleRefreshToken ?? null,
      googleTokenExpiry: new Date(
        tokens.expiry_date ?? Date.now() + 3_600_000,
      ),
    });
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
        minSplitMinutes: 30,
        maxSplitMinutes: 30,
        recurringScheduleHorizonDays: 30,
        appGoogleCalendarName: 'AI Calendar Assistant',
      }),
    );
  }

  async saveToken(code: string, userId?: string) {
    this.logger.log(
      `Attempting to save token with code: ${code.substring(0, 10)}...`,
    );

    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
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

      try {
        this.oauth2Client.setCredentials({
          access_token: tokens.access_token,
        });
        const cal = google.calendar({
          version: 'v3',
          auth: this.oauth2Client,
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
          this.oauth2Client.setCredentials({
            refresh_token: user.googleRefreshToken,
          });
          const { credentials } = await this.oauth2Client.refreshAccessToken();
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
   * Caller must have set OAuth credentials on `this.oauth2Client`.
   */
  private async ensureAppCalendarIdWithClient(
    calendar: ReturnType<typeof google.calendar>,
    userId: string,
  ): Promise<string> {
    const settings = await this.userSettingsRepo.findOne({ where: { userId } });
    const name =
      (settings?.appGoogleCalendarName ?? '').trim() || 'AI Calendar Assistant';
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
    return id;
  }

  /** Updates the Google calendar title when the user renames it in settings (calendar must already exist). */
  async updateAppCalendarSummaryIfLinked(userId: string): Promise<void> {
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
      this.oauth2Client.setCredentials({
        refresh_token: user.googleRefreshToken,
      });
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      await this.userRepo.update(userId, {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(
          credentials.expiry_date ?? Date.now() + 3_600_000,
        ),
      });
      user.googleAccessToken = credentials.access_token;
    }

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });
    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });
    const summary =
      (settings.appGoogleCalendarName ?? '').trim() || 'AI Calendar Assistant';
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
        this.oauth2Client.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await this.oauth2Client.refreshAccessToken();
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

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
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
        fields:
          'items(id,summary,description,start,end,location,attendees,recurringEventId,status,colorId,created,updated,htmlLink,organizer),nextPageToken',
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

  async getEvent(
    userId: string,
    eventId: string,
    calendarId?: string,
  ) {
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
        this.oauth2Client.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
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
      throw new Error(`Failed to fetch event: ${error.message}`);
    }
  }

  async getCalendars(userId: string) {
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
        this.oauth2Client.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    try {
      const response = await calendar.calendarList.list({
        fields:
          'items(id,summary,description,primary,accessRole,backgroundColor,foregroundColor)',
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
          const tz = start.timeZone || end.timeZone || 'UTC';
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
        this.oauth2Client.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new BadRequestException('Google Calendar token expired.');
      }
    }

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Google Calendar insert failed: ${msg}`);
      throw new ServiceUnavailableException(
        'Google Calendar could not create the event.',
      );
    }

    if (phaseId && typeof response.data.id === 'string') {
      await this.eventPhasesService.create(
        response.data.id,
        phaseId,
        String(userId),
      );
    }

    return {
      ...response.data,
      appCalendarId: writableCalendarId,
    };
  }

  async updateEvent(
    userId: string,
    eventId: string,
    event: Record<string, unknown>,
    opts?: { skipSleepWindowCheck?: boolean; calendarId?: string },
  ) {
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
        this.oauth2Client.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new BadRequestException('Google Calendar token expired.');
      }
    }

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    const writableCalendarId =
      opts?.calendarId != null && opts.calendarId !== ''
        ? opts.calendarId
        : await this.ensureAppCalendarIdWithClient(calendar, userId);

    let response;
    try {
      response = await calendar.events.update({
        calendarId: writableCalendarId,
        eventId,
        requestBody,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Google Calendar update failed: ${msg}`);
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

    return {
      ...response.data,
      appCalendarId: writableCalendarId,
    };
  }

  private isGoogleNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as {
      code?: number | string;
      status?: number;
      response?: { status?: number };
    };
    return (
      e.code === 404 ||
      e.code === '404' ||
      e.status === 404 ||
      e.response?.status === 404
    );
  }

  async deleteEvent(userId: string, eventId: string, calendarId?: string) {
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
        this.oauth2Client.setCredentials({
          refresh_token: user.googleRefreshToken,
        });
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.userRepo.update(userId, {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: new Date(credentials.expiry_date),
        });
        user.googleAccessToken = credentials.access_token;
      } else {
        throw new Error('Google Calendar token expired');
      }
    }

    this.oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    const storedApp = await this.getStoredAppCalendarId(userId);
    const calendarIds: string[] = [];
    const pushId = (id?: string | null) => {
      if (id && !calendarIds.includes(id)) calendarIds.push(id);
    };
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

    return { success: true };
  }
}
