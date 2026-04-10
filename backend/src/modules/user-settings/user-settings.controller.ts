import {
  Controller,
  Get,
  Body,
  Patch,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserSettingsService } from './user-settings.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PhasesService } from '../phases/phases.service';

@ApiTags('user-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user-settings')
export class UserSettingsController {
  constructor(
    private readonly userSettingsService: UserSettingsService,
    private readonly phasesService: PhasesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user settings' })
  @ApiResponse({ status: 200, description: 'Return the user settings.' })
  getSettings(@Request() req) {
    return this.userSettingsService.getSettings(req.user.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update user settings' })
  @ApiResponse({
    status: 200,
    description: 'User settings updated successfully.',
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  updateSettings(
    @Request() req,
    @Body() updateUserSettingsDto: UpdateUserSettingsDto,
  ) {
    return this.userSettingsService.updateSettings(
      req.user.userId,
      updateUserSettingsDto,
    );
  }

  @Get('required')
  @ApiOperation({ summary: 'Check if required user settings are filled' })
  @ApiResponse({
    status: 200,
    description: 'Return true if required settings are filled.',
  })
  async checkRequired(@Request() req) {
    const settings = await this.userSettingsService.getSettings(
      req.user.userId,
    );
    const requiredFilled =
      !!settings &&
      !!settings.wakeTime &&
      !!settings.sleepTime &&
      settings.googleCalendarLinked;
    const phaseCount = await this.phasesService.countForUser(req.user.userId);
    return { requiredFilled, hasPhases: phaseCount > 0 };
  }
}
