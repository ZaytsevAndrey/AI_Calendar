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
  @ApiOperation({
    summary: 'List habits (MVP: always empty; soft-disabled)',
  })
  @ApiResponse({ status: 200, description: 'Empty habits list for the current user.' })
  findAll(@Request() req) {
    return this.habitsService.findAll(req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a habit (MVP: disabled)' })
  @ApiResponse({ status: 410, description: 'Habits are disabled.' })
  create(@Request() req, @Body() dto: CreateHabitDto) {
    return this.habitsService.create(req.user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a habit (MVP: disabled)' })
  @ApiResponse({ status: 410, description: 'Habits are disabled.' })
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateHabitDto) {
    return this.habitsService.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a habit (MVP: disabled)' })
  @ApiResponse({ status: 410, description: 'Habits are disabled.' })
  remove(@Request() req, @Param('id') id: string) {
    return this.habitsService.remove(req.user.userId, id);
  }

  @Post(':id/check-ins')
  @ApiOperation({ summary: 'Check in (MVP: disabled)' })
  @ApiResponse({ status: 410, description: 'Habits are disabled.' })
  checkIn(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpsertHabitCheckInDto,
  ) {
    return this.habitsService.setCheckIn(req.user.userId, id, dto.date, true);
  }

  @Delete(':id/check-ins/:date')
  @ApiOperation({ summary: 'Clear check-in (MVP: disabled)' })
  @ApiResponse({ status: 410, description: 'Habits are disabled.' })
  uncheck(
    @Request() req,
    @Param('id') id: string,
    @Param('date') date: string,
  ) {
    return this.habitsService.setCheckIn(req.user.userId, id, date, false);
  }
}
