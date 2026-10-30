import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  Param,
  Query,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScheduleService } from './schedule.service';
import { DisplayedEventMoveService } from './displayed-event-move.service';
import { ProblematicPlaceService } from './problematic-place.service';
import {
  PlaceProblematicDto,
  type PlaceProblematicResult,
} from './dto/place-problematic.dto';
import { ConflictOptionPhrasesService } from './conflict-option-phrases.service';
import {
  FreeSlotsResponse,
  FreeSlotsService,
} from './free-slots.service';
import { ConflictOptionPhrase } from './conflict-option-phrases.util';
import {
  ScheduleQueryDto,
  MoveDisplayedEventDto,
} from './dto';
import { PhraseConflictOptionsDto } from './dto/phrase-conflict-options.dto';
import { ScheduledTask } from './schedule.entity';
import type { SchedulingConflict } from './scheduling-conflict.types';

import { schedulingValidationPipe } from '../../common/scheduling-validation.pipe';

@ApiTags('schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
// AUD-006: DTO whitelist; undeclared body keys (id, userId, …) are stripped.
@UsePipes(schedulingValidationPipe)
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly displayedEventMoveService: DisplayedEventMoveService,
    private readonly conflictOptionPhrasesService: ConflictOptionPhrasesService,
    private readonly freeSlotsService: FreeSlotsService,
    private readonly problematicPlaceService: ProblematicPlaceService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all scheduled items' })
  @ApiResponse({
    status: 200,
    description: 'All scheduled tasks',
    type: [ScheduledTask],
  })
  async findAll(
    @Request() req,
    @Query() query: ScheduleQueryDto,
  ): Promise<ScheduledTask[]> {
    return this.scheduleService.findAll(req.user.userId, query);
  }

  @Get('free-slots')
  @ApiOperation({
    summary:
      'Free gaps and 15-minute candidate starts for placing a Problematic Move on one civil day',
  })
  @ApiResponse({ status: 200, description: 'Day timeline + candidate starts' })
  async freeSlots(
    @Request() req,
    @Query('taskId') taskId: string,
    @Query('ymd') ymd: string,
    @Query('phaseId') phaseId?: string,
  ): Promise<FreeSlotsResponse> {
    return this.freeSlotsService.forTaskDay(
      req.user.userId,
      taskId,
      ymd,
      phaseId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one scheduled item' })
  @ApiResponse({
    status: 200,
    description: 'Scheduled item',
    type: ScheduledTask,
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Request() req,
    @Param('id') id: string,
  ): Promise<ScheduledTask> {
    return this.scheduleService.findOne(id, req.user.userId);
  }

  @Post('problematic/:taskId/place')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Problematic Move: seat a parked task, or one parked series day as a copy, on a chosen free slot',
  })
  @ApiResponse({ status: 200, description: 'Seated; taskId owns the slot' })
  @ApiResponse({ status: 400, description: 'Slot taken or in the past; nothing changed' })
  async placeProblematic(
    @Request() req,
    @Param('taskId') taskId: string,
    @Body() dto: PlaceProblematicDto,
  ): Promise<PlaceProblematicResult> {
    return this.problematicPlaceService.place(req.user.userId, taskId, dto);
  }

  @Post('move-event')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Move or resize one displayed calendar block. Recurring app tasks without seriesScope return series-choice. External Google-only moves do not seat.',
  })
  @ApiResponse({
    status: 200,
    description: 'Occurrence updated, series-choice ask, or Google-only patch; jobId is usually null',
  })
  async moveDisplayedEvent(
    @Request() req,
    @Body() dto: MoveDisplayedEventDto,
  ): Promise<{
    kind: 'fixed' | 'slot' | 'google' | 'series-choice';
    jobId: string | null;
    taskName?: string;
  }> {
    return this.displayedEventMoveService.move(req.user.userId, dto);
  }

  @Post('conflict-option-phrases')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Phrase structured conflict option ids for the shared choice sheet. Groq only phrases; applying uses PATCH/skip.',
  })
  @ApiResponse({ status: 200, description: 'Phrased options (templates if Groq is down)' })
  async phraseConflictOptions(
    @Body() body: PhraseConflictOptionsDto,
  ): Promise<{ options: ConflictOptionPhrase[] }> {
    const conflict: SchedulingConflict = {
      taskId: body.taskId,
      taskName: body.taskName,
      reason: body.reason,
      options: body.options,
      meta: body.meta,
    };
    const options = await this.conflictOptionPhrasesService.phrase(conflict);
    return { options };
  }

}
