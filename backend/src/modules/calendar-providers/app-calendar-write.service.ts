import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserIdentitiesService } from '../auth/user-identities.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { appEventBodyFromGoogle } from './app-event-body';
import {
  resolveAppCalendarProvider,
  type AppCalendarProviderId,
} from './app-calendar-provider.util';
import type {
  AppCalendarWrites,
  AppWriteResult,
} from './app-calendar-writes.token';
import { AppleCalendarProvider } from './apple-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';

const DEFAULT_NAME = 'AI Calendar Assistant';

@Injectable()
export class AppCalendarWriteService implements AppCalendarWrites {
  private readonly logger = new Logger(AppCalendarWriteService.name);

  constructor(
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
    private readonly identities: UserIdentitiesService,
    private readonly google: GoogleCalendarService,
    private readonly microsoft: MicrosoftCalendarProvider,
    private readonly apple: AppleCalendarProvider,
  ) {}

  async resolve(userId: string): Promise<AppCalendarProviderId | null> {
    return resolveAppCalendarProvider(await this.connectionFlags(userId));
  }

  async isConnected(
    userId: string,
    provider: AppCalendarProviderId,
  ): Promise<boolean> {
    const flags = await this.connectionFlags(userId);
    if (provider === 'google') return flags.googleLinked;
    if (provider === 'microsoft') return flags.microsoftConnected;
    return flags.appleConnected;
  }

  async syncHome(userId: string): Promise<void> {
    const home = await this.ensure(userId);
    if (!home) return;
    const name = await this.calendarName(userId);
    if (home.provider === 'google') {
      await this.google.updateAppCalendarSummaryIfLinked(userId);
      return;
    }
    if (home.provider === 'microsoft') {
      await this.microsoft.renameCalendar(userId, home.calendarId, name);
      return;
    }
    await this.apple.renameCalendar(userId, home.calendarId, name);
  }

  async retargetIfDisconnected(
    userId: string,
    disconnected: AppCalendarProviderId,
  ): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: { userId } });
    if (!settings) return;
    if (
      settings.appCalendarProvider &&
      settings.appCalendarProvider !== disconnected
    ) {
      return;
    }
    const next = await this.resolve(userId);
    if (!next || next === disconnected) return;
    await this.settingsRepo.update({ userId }, { appCalendarProvider: next });
    try {
      await this.syncHome(userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Could not create the app calendar on ${next} after disconnect: ${msg}`,
      );
    }
  }

  async createEvent(
    userId: string,
    event: Record<string, unknown>,
  ): Promise<AppWriteResult> {
    const home = await this.ensure(userId);
    if (!home) {
      throw new ServiceUnavailableException(
        'No calendar account is connected for app writes.',
      );
    }
    if (home.provider === 'google') {
      // Caller should use GoogleCalendarService create path for Google.
      throw new ServiceUnavailableException(
        'App calendar create for Google uses GoogleCalendarService.',
      );
    }
    if (home.provider === 'microsoft') {
      const id = await this.microsoft.createAppEvent(
        userId,
        home.calendarId,
        event,
      );
      return {
        id,
        appCalendarId: home.calendarId,
        calendarProvider: 'microsoft',
      };
    }
    const id = await this.apple.createAppEvent(userId, home.calendarId, event);
    return { id, appCalendarId: home.calendarId, calendarProvider: 'apple' };
  }

  async updateEvent(
    userId: string,
    provider: 'microsoft' | 'apple',
    eventId: string,
    event: Record<string, unknown>,
    calendarId?: string,
  ): Promise<void> {
    const body = appEventBodyFromGoogle(event);
    const target = provider === 'microsoft' ? this.microsoft : this.apple;
    await target.updateEvent(
      userId,
      eventId,
      {
        summary: body.summary,
        description: body.description,
        location: body.location,
        start: body.start?.dateTime
          ? { dateTime: body.start.dateTime, timeZone: body.start.timeZone }
          : undefined,
        end: body.end?.dateTime
          ? { dateTime: body.end.dateTime, timeZone: body.end.timeZone }
          : undefined,
      },
      calendarId,
    );
  }

  async deleteEvent(
    userId: string,
    provider: 'microsoft' | 'apple',
    eventId: string,
    calendarId?: string,
  ): Promise<void> {
    const target = provider === 'microsoft' ? this.microsoft : this.apple;
    await target.deleteEvent(userId, eventId, calendarId);
  }

  async patchTimes(
    userId: string,
    provider: 'microsoft' | 'apple',
    eventId: string,
    startIso: string,
    endIso: string,
    calendarId?: string,
  ): Promise<void> {
    await this.updateEvent(
      userId,
      provider,
      eventId,
      {
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      },
      calendarId,
    );
  }

  private async ensure(
    userId: string,
  ): Promise<{ provider: AppCalendarProviderId; calendarId: string } | null> {
    const provider = await this.resolve(userId);
    if (!provider) return null;
    const settings = await this.settingsRepo.findOne({ where: { userId } });
    const name = (settings?.appGoogleCalendarName ?? '').trim() || DEFAULT_NAME;
    if (provider === 'google') {
      const calendarId = await this.google.ensureStoredAppCalendar(userId);
      if (settings?.appCalendarProvider !== 'google') {
        await this.settingsRepo.update(
          { userId },
          { appCalendarProvider: 'google' },
        );
      }
      return { provider, calendarId };
    }
    if (provider === 'microsoft') {
      const calendarId = await this.microsoft.ensureNamedCalendar(
        userId,
        name,
        settings?.appMicrosoftCalendarId ?? null,
      );
      await this.settingsRepo.update(
        { userId },
        {
          appCalendarProvider: 'microsoft',
          appMicrosoftCalendarId: calendarId,
        },
      );
      return { provider, calendarId };
    }
    const calendarId = await this.apple.ensureNamedCalendar(
      userId,
      name,
      settings?.appAppleCalendarId ?? null,
    );
    await this.settingsRepo.update(
      { userId },
      { appCalendarProvider: 'apple', appAppleCalendarId: calendarId },
    );
    return { provider, calendarId };
  }

  private async calendarName(userId: string): Promise<string> {
    const settings = await this.settingsRepo.findOne({ where: { userId } });
    return (settings?.appGoogleCalendarName ?? '').trim() || DEFAULT_NAME;
  }

  private async connectionFlags(userId: string): Promise<{
    stored?: string | null;
    googleLinked: boolean;
    microsoftConnected: boolean;
    appleConnected: boolean;
  }> {
    const [settings, rows] = await Promise.all([
      this.settingsRepo.findOne({ where: { userId } }),
      this.identities.listForUser(userId),
    ]);
    return {
      stored: settings?.appCalendarProvider,
      googleLinked: !!settings?.googleCalendarLinked,
      microsoftConnected: rows.some(
        (row) => row.provider === 'microsoft' && !!row.accessToken,
      ),
      appleConnected: rows.some(
        (row) => row.provider === 'apple' && !!row.accessToken,
      ),
    };
  }
}
