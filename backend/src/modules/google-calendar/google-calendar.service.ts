import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { EventPhasesService } from '../event-phases/event-phases.service';

@Injectable()
export class GoogleCalendarService {
  private oauth2Client;
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserSettings)
    private userSettingsRepo: Repository<UserSettings>,
    private eventPhasesService: EventPhasesService,
  ) {
    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.configService.get('GOOGLE_REDIRECT_URI');

    this.logger.log(`Initializing Google OAuth2 with:`);
    this.logger.log(`Client ID: ${clientId ? 'SET' : 'NOT SET'}`);
    this.logger.log(`Client Secret: ${clientSecret ? 'SET' : 'NOT SET'}`);
    this.logger.log(`Redirect URI: ${redirectUri}`);

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost:3001/google-calendar/callback', // Backend port
    );
  }

  getAuthUrl(userId?: string) {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: userId, // Передаємо userId через state
    });

    this.logger.log(`Generated auth URL for user ${userId}: ${authUrl}`);
    return authUrl;
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
        googleTokenExpiry: new Date(tokens.expiry_date),
      });

      await this.userSettingsRepo.update(
        { userId: user.id },
        { googleCalendarLinked: true },
      );

      this.logger.log(`Successfully saved Google tokens for user ${user.id}`);
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

    // Перевіряємо чи токен не прострочений
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

      // Очищаємо токени
      await this.userRepo.update(userId, {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
      });

      // Оновлюємо статус підключення
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
    calendarId: string = 'primary',
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

    // Оновлюємо токен якщо потрібно
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

    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        pageToken,
        singleEvents: true,
        orderBy: 'startTime',
        fields:
          'items(id,summary,description,start,end,location,attendees,recurringEventId,status,colorId,created,updated),nextPageToken',
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
    calendarId: string = 'primary',
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

    // Оновлюємо токен якщо потрібно
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
      const response = await calendar.events.get({
        calendarId,
        eventId,
      });

      this.logger.log(
        `Successfully fetched event ${eventId} for user ${userId}`,
      );
      // Додати phaseId до відповіді, якщо є звʼязок
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

    // Оновлюємо токен якщо потрібно
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

  async createEvent(userId: string, event: any) {
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

    // Оновлюємо токен якщо потрібно
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
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    // Якщо у event є phaseId, створити звʼязок у event_phases
    if (event.phaseId) {
      if (typeof response.data.id === 'string' && event.phaseId && userId) {
        await this.eventPhasesService.create(response.data.id, String(event.phaseId), String(userId));
      }
    }

    return response.data;
  }

  async updateEvent(userId: string, eventId: string, event: any) {
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

    // Оновлюємо токен якщо потрібно
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
    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId,
      requestBody: event,
    });

    // Оновити або створити звʼязок у event_phases
    if (event.phaseId) {
      const existing = await this.eventPhasesService.findByEvent(eventId, String(userId));
      if (existing) {
        await this.eventPhasesService.update(existing.id, String(event.phaseId));
      } else {
        await this.eventPhasesService.create(eventId, String(event.phaseId), String(userId));
      }
    } else {
      // Якщо phaseId не передано — видалити звʼязок
      const existing = await this.eventPhasesService.findByEvent(eventId, String(userId));
      if (existing) {
        await this.eventPhasesService.remove(existing.id);
      }
    }

    return response.data;
  }

  /**
   * Partial update of event start/end only (used e.g. after schedule undo).
   * Preserves summary, attendees, etc. Requires Google connection.
   */
  async patchEventDateTime(
    userId: string,
    eventId: string,
    start: Date,
    end: Date,
  ): Promise<void> {
    const existing = await this.getEvent(userId, eventId);
    const tz =
      (existing.start as { timeZone?: string } | undefined)?.timeZone ||
      (existing.end as { timeZone?: string } | undefined)?.timeZone ||
      'UTC';

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

    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: {
        start: { dateTime: start.toISOString(), timeZone: tz },
        end: { dateTime: end.toISOString(), timeZone: tz },
      },
    });
  }

  async deleteEvent(userId: string, eventId: string) {
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

    // Оновлюємо токен якщо потрібно
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
    const response = await calendar.events.delete({
      calendarId: 'primary',
      eventId,
    });

    return response.data;
  }
}
