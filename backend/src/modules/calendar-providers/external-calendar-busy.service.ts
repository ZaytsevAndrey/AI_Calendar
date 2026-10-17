import { Injectable } from '@nestjs/common';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { isHiddenCalendar } from './calendar-visibility.util';
import type { ProviderEvent } from './calendar-provider.types';
import { CalendarProvidersRegistry } from './calendar-providers.registry';

/**
 * Visible events from every connected calendar (Google, Microsoft, Apple).
 * Hidden calendars are dropped. A provider that fails to list is skipped
 * inside the registry; a failure of the whole load still rejects.
 */
@Injectable()
export class ExternalCalendarBusyService {
  constructor(
    private readonly registry: CalendarProvidersRegistry,
    private readonly userSettings: UserSettingsService,
  ) {}

  async anyConnected(userId: string): Promise<boolean> {
    for (const provider of this.registry.all()) {
      try {
        if (await provider.isConnected(userId)) return true;
      } catch {
        /* try the next provider */
      }
    }
    return false;
  }

  async listVisibleEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    const [events, settings] = await Promise.all([
      this.registry.listAllEvents(userId, timeMin, timeMax),
      this.userSettings.getSettings(userId),
    ]);
    const hiddenIds = Array.isArray(settings?.hiddenGoogleCalendarIds)
      ? settings.hiddenGoogleCalendarIds
      : [];
    return events.filter(
      (ev) => !isHiddenCalendar(ev.provider, ev.calendarId, hiddenIds),
    );
  }
}
