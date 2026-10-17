import { Injectable } from '@nestjs/common';
import type {
  CalendarProvider,
  CalendarProviderId,
  ProviderCalendar,
  ProviderEvent,
} from './calendar-provider.types';
import { AppleCalendarProvider } from './apple-calendar.provider';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';

@Injectable()
export class CalendarProvidersRegistry {
  constructor(
    private readonly google: GoogleCalendarProvider,
    private readonly microsoft: MicrosoftCalendarProvider,
    private readonly apple: AppleCalendarProvider,
  ) {}

  all(): CalendarProvider[] {
    const list: CalendarProvider[] = [this.google];
    if (this.microsoft.isConfigured()) list.push(this.microsoft);
    if (this.apple.isConfigured()) list.push(this.apple);
    return list;
  }

  get(id: CalendarProviderId): CalendarProvider | undefined {
    return this.all().find((p) => p.id === id);
  }

  async listAllCalendars(userId: string): Promise<ProviderCalendar[]> {
    const out: ProviderCalendar[] = [];
    for (const provider of this.all()) {
      try {
        if (!(await provider.isConnected(userId))) continue;
        out.push(...(await provider.listCalendars(userId)));
      } catch {
        // Skip providers that fail listing (token expiry, etc.)
      }
    }
    return out;
  }

  async listAllEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    const chunks = await Promise.all(
      this.all().map(async (provider) => {
        try {
          if (!(await provider.isConnected(userId))) return [] as ProviderEvent[];
          return await provider.listEvents(userId, timeMin, timeMax);
        } catch {
          return [] as ProviderEvent[];
        }
      }),
    );
    return chunks.flat();
  }
}
