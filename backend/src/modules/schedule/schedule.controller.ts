import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScheduleService } from './schedule.service';
import { ScheduleJobService } from './schedule-job.service';
import { DisplayedEventMoveService } from './displayed-event-move.service';
import { ScheduleRecommendationsService } from './schedule-recommendations.service';
import { ConflictOptionPhrasesService } from './conflict-option-phrases.service';
import {
  FreeSlotsResponse,
  FreeSlotsService,
} from './free-slots.service';
import { ScheduleRecommendations } from './schedule-recommendations.util';
import { ConflictOptionPhrase } from './conflict-option-phrases.util';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleQueryDto,
  GenerateScheduleDto,
  MoveDisplayedEventDto,
} from './dto';
import { PhraseConflictOptionsDto } from './dto/phrase-conflict-options.dto';
import { ScheduledTask } from './schedule.entity';
import {
  DiffItem,
  SchedulingConflict,
  SchedulingWarning,
} from './intelligent-scheduling.engine';

@ApiTags('schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly scheduleJobService: ScheduleJobService,
    private readonly displayedEventMoveService: DisplayedEventMoveService,
    private readonly scheduleRecommendationsService: ScheduleRecommendationsService,
    private readonly conflictOptionPhrasesService: ConflictOptionPhrasesService,
    private readonly freeSlotsService: FreeSlotsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new scheduled item' })
  @ApiResponse({
    status: 201,
    description: 'Created successfully',
    type: ScheduledTask,
  })
  async create(
    @Request() req,
    @Body() createScheduleDto: CreateScheduleDto,
  ): Promise<ScheduledTask> {
    return this.scheduleService.create(req.user.userId, createScheduleDto);
  }

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

  @Patch(':id')
  @ApiOperation({ summary: 'Update a scheduled item' })
  @ApiResponse({
    status: 200,
    description: 'Updated item',
    type: ScheduledTask,
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateScheduleDto: UpdateScheduleDto,
  ): Promise<ScheduledTask> {
    return this.scheduleService.update(id, req.user.userId, updateScheduleDto);
  }

  @Delete()
  @ApiOperation({
    summary:
      'Clear app-generated slots in the planning horizon (Settings: recurringScheduleHorizonDays)',
  })
  @ApiResponse({ status: 200, description: 'Schedule cleared' })
  async clearSchedule(@Request() req): Promise<{ deleted: number }> {
    return this.scheduleService.clearSchedule(req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a scheduled item' })
  @ApiResponse({ status: 200, description: 'Deleted successfully' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async remove(@Request() req, @Param('id') id: string): Promise<void> {
    return this.scheduleService.remove(id, req.user.userId);
  }

  @Post('move-event')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Move or resize one displayed calendar block. App fixed/slot moves enqueue a silent replan (jobId); conflicts open the shared sheet. External Google-only moves do not replan.',
  })
  @ApiResponse({ status: 200, description: 'Occurrence and Google event updated; optional jobId' })
  async moveDisplayedEvent(
    @Request() req,
    @Body() dto: MoveDisplayedEventDto,
  ): Promise<{ kind: 'fixed' | 'slot' | 'google'; jobId: string | null }> {
    return this.displayedEventMoveService.move(req.user.userId, dto);
  }

  @Post('recommendations')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Suggest schedule improvements for the next 7 days. Does not change tasks, slots, or Google.',
  })
  @ApiResponse({ status: 200, description: 'Suggestions only' })
  async recommendations(@Request() req): Promise<ScheduleRecommendations> {
    return this.scheduleRecommendationsService.recommend(req.user.userId);
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

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Dry-run the same placement as Generate. Does not write slots, Google, or undo.',
  })
  @ApiResponse({ status: 200, description: 'Projected diff, warnings, and errors' })
  async previewSchedule(@Request() req): Promise<{
    diff: DiffItem[];
    warnings: SchedulingWarning[];
    errors: { taskId: string; message: string }[];
    conflicts: SchedulingConflict[];
  }> {
    return this.scheduleJobService.preview(req.user.userId);
  }

  @Post('generate')
  @ApiOperation({
    summary:
      'Enqueue intelligent replan (async). Poll GET /schedule-jobs/:jobId for diff.',
  })
  @ApiResponse({ status: 201, description: 'Job enqueued' })
  async generateSchedule(
    @Request() req,
    @Body() _generateDto: GenerateScheduleDto,
  ): Promise<{ jobId: string; status: string; message: string }> {
    const job = await this.scheduleJobService.enqueueGenerate(req.user.userId);
    return {
      jobId: job.id,
      status: job.status,
      message:
        'Poll GET /schedule-jobs/:id until status is done, then refresh /schedule.',
    };
  }
}
