import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  HttpCode,
  Headers,
  BadRequestException,
  UsePipes,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { SkipOccurrenceDto } from './dto/skip-occurrence.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TaskStatus } from './entities/task.entity';

import { schedulingValidationPipe } from '../../common/scheduling-validation.pipe';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
// AUD-006: DTO whitelist; undeclared body keys (id, userId, …) are stripped.
@UsePipes(schedulingValidationPipe)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({ status: 201, description: 'Task created successfully.' })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'One id per create operation (1–64 of A-Z a-z 0-9 . _ : -). Sending it again returns the task the first request made.',
  })
  create(
    @Request() req,
    @Body() createTaskDto: CreateTaskDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const requestKey = idempotencyKey?.trim() || null;
    if (requestKey && !/^[A-Za-z0-9._:-]{1,64}$/.test(requestKey)) {
      throw new BadRequestException('Idempotency-Key must be 1-64 characters of A-Z a-z 0-9 . _ : -');
    }
    return this.tasksService.create(req.user.userId, createTaskDto, { requestKey });
  }

  @Get()
  @ApiOperation({ summary: 'Get all tasks for the current user' })
  @ApiResponse({ status: 200, description: 'Return all tasks.' })
  @ApiQuery({ name: 'status', required: false, enum: TaskStatus })
  @ApiQuery({ name: 'phaseId', required: false })
  findAll(
    @Request() req,
    @Query('status') status?: TaskStatus,
    @Query('phaseId') phaseId?: string,
  ) {
    const userId = req.user.userId;

    if (status) {
      return this.tasksService.findByStatus(userId, status);
    }

    if (phaseId) {
      return this.tasksService.findByPhase(userId, phaseId);
    }

    return this.tasksService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by id' })
  @ApiResponse({ status: 200, description: 'Return the task.' })
  @ApiResponse({ status: 404, description: 'Task not found.' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.tasksService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated successfully.' })
  @ApiResponse({ status: 404, description: 'Task not found.' })
  update(
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @Request() req,
  ) {
    return this.tasksService.update(id, req.user.userId, updateTaskDto);
  }

  @Post(':id/skip-occurrence')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Skip one still-open slot or recurring instance without completing the task',
  })
  @ApiResponse({ status: 200, description: 'Occurrence skipped.' })
  @ApiResponse({ status: 400, description: 'Nothing to skip or occurrence already ended.' })
  @ApiResponse({ status: 404, description: 'Task not found.' })
  skipOccurrence(
    @Param('id') id: string,
    @Body() dto: SkipOccurrenceDto,
    @Request() req,
  ) {
    return this.tasksService.skipOccurrence(id, req.user.userId, dto);
  }

  @Post(':id/end-series-from')
  @HttpCode(200)
  @ApiOperation({
    summary: 'End a recurring series from the given day onward (keeps earlier days)',
  })
  @ApiResponse({ status: 200, description: 'Series ended from that day.' })
  @ApiResponse({ status: 400, description: 'Not a recurring task or invalid occurrence.' })
  @ApiResponse({ status: 404, description: 'Task not found.' })
  endSeriesFrom(
    @Param('id') id: string,
    @Body() dto: SkipOccurrenceDto,
    @Request() req,
  ) {
    return this.tasksService.endSeriesFrom(id, req.user.userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Task not found.' })
  remove(@Param('id') id: string, @Request() req) {
    return this.tasksService.remove(id, req.user.userId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status' })
  @ApiResponse({
    status: 200,
    description: 'Task status updated successfully.',
  })
  @ApiResponse({ status: 404, description: 'Task not found.' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: TaskStatus,
    @Request() req,
  ) {
    return this.tasksService.updateStatus(id, req.user.userId, status);
  }
}
