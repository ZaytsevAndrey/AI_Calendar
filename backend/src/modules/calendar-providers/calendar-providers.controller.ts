import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserSettingsService } from '../user-settings/user-settings.service';
import type { CalendarProviderId } from './calendar-provider.types';
import { isHiddenCalendar } from './calendar-visibility.util';
import { CalendarProvidersRegistry } from './calendar-providers.registry';

const PROVIDERS = new Set<CalendarProviderId>(['google', 'microsoft', 'apple']);

function parseProvider(raw: string): CalendarProviderId {
  if (!PROVIDERS.has(raw as CalendarProviderId)) {
    throw new BadRequestException(`Unknown provider: ${raw}`);
  }
  return raw as CalendarProviderId;
}

@ApiTags('calendar-providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calendar-providers')
export class CalendarProvidersController {
  constructor(
    private readonly registry: CalendarProvidersRegistry,
    private readonly userSettings: UserSettingsService,
  ) {}

  @Get('calendars')
  @ApiOperation({
    summary: 'List calendars from all connected providers (sectioned by provider)',
  })
  @ApiResponse({ status: 200 })
  async listCalendars(@Request() req) {
    const calendars = await this.registry.listAllCalendars(req.user.userId);
    const sections: Record<string, typeof calendars> = {};
    for (const cal of calendars) {
      (sections[cal.provider] ??= []).push(cal);
    }
    return {
      providers: this.registry.all().map((p) => p.id),
      sections,
      calendars,
    };
  }

  @Get('events')
  @ApiOperation({ summary: 'List display events from all connected providers' })
  async listEvents(
    @Request() req,
    @Query('timeMin') timeMin: string,
    @Query('timeMax') timeMax: string,
  ) {
    const [events, settings] = await Promise.all([
      this.registry.listAllEvents(req.user.userId, timeMin, timeMax),
      this.userSettings.getSettings(req.user.userId),
    ]);
    const hiddenIds = Array.isArray(settings?.hiddenGoogleCalendarIds)
      ? settings.hiddenGoogleCalendarIds
      : [];
    // Google display list already applies hide; still filter MS/Apple (+ safety).
    const visible = events.filter(
      (ev) => !isHiddenCalendar(ev.provider, ev.calendarId, hiddenIds),
    );
    return { events: visible, totalEvents: visible.length };
  }

  @Put(':provider/events/:eventId')
  @ApiOperation({ summary: 'Update an event on the given provider' })
  async updateEvent(
    @Request() req,
    @Param('provider') providerRaw: string,
    @Param('eventId') eventId: string,
    @Query('calendarId') calendarId: string | undefined,
    @Body()
    body: {
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
    },
  ) {
    const providerId = parseProvider(providerRaw);
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new BadRequestException(`Provider ${providerId} is not available`);
    }
    const start =
      body.start?.dateTime != null
        ? { dateTime: body.start.dateTime, timeZone: body.start.timeZone }
        : undefined;
    const end =
      body.end?.dateTime != null
        ? { dateTime: body.end.dateTime, timeZone: body.end.timeZone }
        : undefined;
    return provider.updateEvent(
      req.user.userId,
      decodeURIComponent(eventId),
      {
        summary: body.summary,
        description: body.description,
        location: body.location,
        start,
        end,
      },
      calendarId,
    );
  }

  @Delete(':provider/events/:eventId')
  @ApiOperation({ summary: 'Delete an event on the given provider' })
  async deleteEvent(
    @Request() req,
    @Param('provider') providerRaw: string,
    @Param('eventId') eventId: string,
    @Query('calendarId') calendarId: string | undefined,
  ) {
    const providerId = parseProvider(providerRaw);
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new BadRequestException(`Provider ${providerId} is not available`);
    }
    await provider.deleteEvent(
      req.user.userId,
      decodeURIComponent(eventId),
      calendarId,
    );
    return { ok: true };
  }
}
