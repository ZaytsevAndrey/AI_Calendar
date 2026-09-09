import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { UpsertHabitCheckInDto } from './dto/upsert-habit-check-in.dto';
import { HabitsService } from './habits.service';

@ApiTags('habits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  @Get()
  @ApiOperation({ summary: 'List habits with streaks, points, and today/yesterday status' })
  @ApiResponse({ status: 200, description: 'Habits for the current user.' })
  findAll(@Request() req) {
    return this.habitsService.findAll(req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a habit' })
  @ApiResponse({ status: 201, description: 'Habit created.' })
  create(@Request() req, @Body() dto: CreateHabitDto) {
    return this.habitsService.create(req.user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a habit' })
  @ApiResponse({ status: 200, description: 'Habit updated.' })
  @ApiResponse({ status: 404, description: 'Habit not found.' })
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateHabitDto) {
    return this.habitsService.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a habit and its check-ins' })
  @ApiResponse({ status: 200, description: 'Habit deleted.' })
  @ApiResponse({ status: 404, description: 'Habit not found.' })
  remove(@Request() req, @Param('id') id: string) {
    return this.habitsService.remove(req.user.userId, id);
  }

  @Post(':id/check-ins')
  @ApiOperation({ summary: 'Mark today or yesterday as done' })
  @ApiResponse({ status: 201, description: 'Check-in saved.' })
  @ApiResponse({ status: 400, description: 'Date is not today or yesterday.' })
  checkIn(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpsertHabitCheckInDto,
  ) {
    return this.habitsService.setCheckIn(req.user.userId, id, dto.date, true);
  }

  @Delete(':id/check-ins/:date')
  @ApiOperation({ summary: 'Clear a today or yesterday check-in' })
  @ApiResponse({ status: 200, description: 'Check-in removed.' })
  uncheck(
    @Request() req,
    @Param('id') id: string,
    @Param('date') date: string,
  ) {
    return this.habitsService.setCheckIn(req.user.userId, id, date, false);
  }
}
