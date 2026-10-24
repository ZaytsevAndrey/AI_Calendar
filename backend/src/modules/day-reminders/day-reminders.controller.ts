import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DayRemindersService } from './day-reminders.service';
import { WriteDayReminderDto } from './dto/write-day-reminder.dto';

@ApiTags('day-reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('day-reminders')
export class DayRemindersController {
  constructor(private readonly dayReminders: DayRemindersService) {}

  @Get()
  @ApiOperation({ summary: 'Open day reminders for the current user' })
  findAll(@Request() req) {
    return this.dayReminders.findAll(req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a day reminder and its Google notification' })
  create(@Request() req, @Body() dto: WriteDayReminderDto) {
    return this.dayReminders.create(req.user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a day reminder' })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: WriteDayReminderDto,
  ) {
    return this.dayReminders.update(req.user.userId, id, dto);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve the open occurrence' })
  resolve(@Request() req, @Param('id') id: string) {
    return this.dayReminders.resolve(req.user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a day reminder and its Google event' })
  async remove(@Request() req, @Param('id') id: string) {
    await this.dayReminders.remove(req.user.userId, id);
    return { deleted: true };
  }
}
