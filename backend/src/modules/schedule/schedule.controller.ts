import {
  Controller,
  Get,
  Post,
  Body,
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
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleQueryDto,
  GenerateScheduleDto,
} from './dto';
import { ScheduledTask } from './schedule.entity';

@ApiTags('schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly scheduleJobService: ScheduleJobService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Створити новий запланований елемент' })
  @ApiResponse({
    status: 201,
    description: 'Успішно створено',
    type: ScheduledTask,
  })
  async create(
    @Request() req,
    @Body() createScheduleDto: CreateScheduleDto,
  ): Promise<ScheduledTask> {
    return this.scheduleService.create(req.user.userId, createScheduleDto);
  }

  @Get()
  @ApiOperation({ summary: 'Отримати всі заплановані елементи' })
  @ApiResponse({
    status: 200,
    description: 'Список всіх запланованих завдань',
    type: [ScheduledTask],
  })
  async findAll(
    @Request() req,
    @Query() query: ScheduleQueryDto,
  ): Promise<ScheduledTask[]> {
    return this.scheduleService.findAll(req.user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Отримати один запланований елемент' })
  @ApiResponse({
    status: 200,
    description: 'Запланований елемент',
    type: ScheduledTask,
  })
  @ApiResponse({ status: 404, description: 'Не знайдено' })
  async findOne(
    @Request() req,
    @Param('id') id: string,
  ): Promise<ScheduledTask> {
    return this.scheduleService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Оновити запланований елемент' })
  @ApiResponse({
    status: 200,
    description: 'Оновлений елемент',
    type: ScheduledTask,
  })
  @ApiResponse({ status: 404, description: 'Не знайдено' })
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateScheduleDto: UpdateScheduleDto,
  ): Promise<ScheduledTask> {
    return this.scheduleService.update(id, req.user.userId, updateScheduleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Видалити запланований елемент' })
  @ApiResponse({ status: 200, description: 'Успішно видалено' })
  @ApiResponse({ status: 404, description: 'Не знайдено' })
  async remove(@Request() req, @Param('id') id: string): Promise<void> {
    return this.scheduleService.remove(id, req.user.userId);
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
    const job = await this.scheduleJobService.enqueueReplan(req.user.userId);
    return {
      jobId: job.id,
      status: job.status,
      message:
        'Poll GET /schedule-jobs/:id until status is done, then refresh /schedule.',
    };
  }

  @Delete()
  @ApiOperation({ summary: 'Очистити розклад за вказаний період' })
  @ApiResponse({ status: 200, description: 'Розклад очищено' })
  async clearSchedule(
    @Request() req,
    @Body() clearDto: GenerateScheduleDto,
  ): Promise<void> {
    return this.scheduleService.clearSchedule(
      req.user.userId,
      clearDto.startDate,
      clearDto.endDate,
    );
  }
}
