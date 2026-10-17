import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Post,
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
import type { CalendarProviderId } from '../calendar-providers/calendar-provider.types';
import { CalendarOverlaysService } from './calendar-overlays.service';
import {
  SetOverlayModeDto,
  UnscheduleOverlayDto,
} from './dto/set-overlay-mode.dto';

const PROVIDERS = new Set<CalendarProviderId>(['google', 'microsoft', 'apple']);

function parseProvider(raw: string): CalendarProviderId {
  if (!PROVIDERS.has(raw as CalendarProviderId)) {
    throw new BadRequestException(`Unknown provider: ${raw}`);
  }
  return raw as CalendarProviderId;
}

@ApiTags('calendar-overlays')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calendar-overlays')
export class CalendarOverlaysController {
  constructor(private readonly overlaysService: CalendarOverlaysService) {}

  @Get()
  @ApiOperation({ summary: 'List scheduling-mode overlays for external events' })
  @ApiResponse({ status: 200 })
  list(@Request() req) {
    return this.overlaysService.listForUser(req.user.userId);
  }

  @Put(':provider/:eventId')
  @ApiOperation({
    summary: 'Set fixed/flexible overlay on an external calendar event (lazy create)',
  })
  setMode(
    @Request() req,
    @Param('provider') provider: string,
    @Param('eventId') eventId: string,
    @Body() dto: SetOverlayModeDto,
  ) {
    return this.overlaysService.setMode(
      req.user.userId,
      parseProvider(provider),
      decodeURIComponent(eventId),
      dto,
    );
  }

  @Post(':provider/:eventId/unschedule')
  @ApiOperation({
    summary:
      'Remove the external event and create a local Unscheduled task (with confirmation on the client)',
  })
  unschedule(
    @Request() req,
    @Param('provider') provider: string,
    @Param('eventId') eventId: string,
    @Body() dto: UnscheduleOverlayDto,
  ) {
    return this.overlaysService.unschedule(
      req.user.userId,
      parseProvider(provider),
      decodeURIComponent(eventId),
      dto,
    );
  }

  @Delete(':provider/:eventId')
  @ApiOperation({ summary: 'Delete an overlay without touching the external event' })
  remove(
    @Request() req,
    @Param('provider') provider: string,
    @Param('eventId') eventId: string,
  ) {
    return this.overlaysService.remove(
      req.user.userId,
      parseProvider(provider),
      decodeURIComponent(eventId),
    );
  }
}
