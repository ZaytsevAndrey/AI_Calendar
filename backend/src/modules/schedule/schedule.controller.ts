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
import { ScheduleRecommendations } from './schedule-recommendations.util';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleQueryDto,
  GenerateScheduleDto,
  MoveDisplayedEventDto,
} from './dto';
import { ScheduledTask } from './schedule.entity';
import {
  DiffItem,
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
      'Move or resize one displayed calendar block. Does not enqueue replan. A flexible slot can move again on the next Generate.',
  })
  @ApiResponse({ status: 200, description: 'Occurrence and Google event updated' })
  async moveDisplayedEvent(
    @Request() req,
    @Body() dto: MoveDisplayedEventDto,
  ): Promise<{ kind: 'fixed' | 'slot' | 'google' }> {
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
