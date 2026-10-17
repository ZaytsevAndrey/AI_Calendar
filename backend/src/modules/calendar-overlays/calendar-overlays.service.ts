import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEventType } from '../scheduling/event-type.enum';
import { TasksService } from '../tasks/tasks.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { AppleCalendarProvider } from '../calendar-providers/apple-calendar.provider';
import { MicrosoftCalendarProvider } from '../calendar-providers/microsoft-calendar.provider';
import type { CalendarProviderId } from '../calendar-providers/calendar-provider.types';
import { CalendarEventOverlay } from './entities/calendar-event-overlay.entity';
import {
  SetOverlayModeDto,
  UnscheduleOverlayDto,
} from './dto/set-overlay-mode.dto';

@Injectable()
export class CalendarOverlaysService {
  constructor(
    @InjectRepository(CalendarEventOverlay)
    private readonly overlayRepo: Repository<CalendarEventOverlay>,
    private readonly tasksService: TasksService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly microsoftCalendar: MicrosoftCalendarProvider,
    private readonly appleCalendar: AppleCalendarProvider,
  ) {}

  listForUser(userId: string): Promise<CalendarEventOverlay[]> {
    return this.overlayRepo.find({ where: { userId } });
  }

  async setMode(
    userId: string,
    provider: CalendarProviderId,
    eventId: string,
    dto: SetOverlayModeDto,
  ): Promise<CalendarEventOverlay> {
    if (!eventId?.trim()) {
      throw new BadRequestException('eventId is required');
    }
    const calendarId = dto.calendarId?.trim() || 'primary';
    let row = await this.overlayRepo.findOne({
      where: { userId, provider, externalEventId: eventId },
    });
    if (!row) {
      row = this.overlayRepo.create({
        userId,
        provider,
        externalEventId: eventId,
        externalCalendarId: calendarId,
        schedulingMode: dto.schedulingMode,
      });
    } else {
      row.schedulingMode = dto.schedulingMode;
      if (dto.calendarId?.trim()) {
        row.externalCalendarId = dto.calendarId.trim();
      }
    }
    return this.overlayRepo.save(row);
  }

  async unschedule(
    userId: string,
    provider: CalendarProviderId,
    eventId: string,
    dto: UnscheduleOverlayDto,
  ): Promise<{ taskId: string }> {
    if (!eventId?.trim()) {
      throw new BadRequestException('eventId is required');
    }
    const calendarId = dto.calendarId?.trim();

    if (provider === 'google') {
      await this.googleCalendarService.deleteEvent(userId, eventId, calendarId);
    } else if (provider === 'microsoft') {
      await this.microsoftCalendar.deleteEvent(userId, eventId, calendarId);
    } else if (provider === 'apple') {
      await this.appleCalendar.deleteEvent(userId, eventId, calendarId);
    } else {
      throw new BadRequestException(
        `Unschedule for provider "${provider}" is not available yet`,
      );
    }

    await this.overlayRepo.delete({
      userId,
      provider,
      externalEventId: eventId,
    });

    const title = (dto.title?.trim() || 'Untitled event').slice(0, 500);
    const created = await this.tasksService.create(userId, {
      name: title,
      isUnscheduled: true,
      eventType: TaskEventType.ADMIN,
    });

    return { taskId: created.id };
  }

  async remove(
    userId: string,
    provider: CalendarProviderId,
    eventId: string,
  ): Promise<void> {
    const result = await this.overlayRepo.delete({
      userId,
      provider,
      externalEventId: eventId,
    });
    if (!result.affected) {
      throw new NotFoundException('Overlay not found');
    }
  }
}
