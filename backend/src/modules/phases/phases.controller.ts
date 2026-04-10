import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PhasesService } from './phases.service';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { SetupDefaultPhasesDto } from './dto/setup-default-phases.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('phases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('phases')
export class PhasesController {
  constructor(private readonly phasesService: PhasesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new phase' })
  @ApiResponse({ status: 201, description: 'Phase created successfully.' })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  create(@Request() req, @Body() createPhaseDto: CreatePhaseDto) {
    return this.phasesService.create(req.user.userId, createPhaseDto);
  }

  @Post('setup-defaults')
  @ApiOperation({
    summary: 'Create default Sleep + Focus phases from user settings (once)',
  })
  @ApiResponse({ status: 201, description: 'Default phases created.' })
  @ApiResponse({ status: 400, description: 'Phases already exist.' })
  setupDefaults(@Request() req, @Body() dto: SetupDefaultPhasesDto) {
    return this.phasesService.setupDefaultPhases(
      req.user.userId,
      dto.weekDays ?? null,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all phases for current user' })
  @ApiResponse({ status: 200, description: 'Return all phases.' })
  findAll(@Request() req) {
    return this.phasesService.findAll(req.user.userId);
  }

  @Get('time-phases')
  @ApiOperation({ summary: 'Get time phases' })
  @ApiResponse({ status: 200, description: 'Return time phases.' })
  getTimePhases(@Request() req) {
    return this.phasesService.getTimePhases(req.user.userId);
  }

  @Get('time-phases/date/:date')
  @ApiOperation({ summary: 'Get time phases for specific date' })
  @ApiResponse({ status: 200, description: 'Return time phases for date.' })
  getTimePhasesForDate(@Request() req, @Param('date') date: string) {
    return this.phasesService.getTimePhasesForDate(
      req.user.userId,
      new Date(date),
    );
  }

  @Get('sleep-time')
  @ApiOperation({ summary: 'Get sleep time phases' })
  @ApiResponse({ status: 200, description: 'Return sleep time phases.' })
  getSleepTimePhases(@Request() req) {
    return this.phasesService.getSleepTimePhases(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a phase by id' })
  @ApiResponse({ status: 200, description: 'Return the phase.' })
  @ApiResponse({ status: 404, description: 'Phase not found.' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.phasesService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a phase' })
  @ApiResponse({ status: 200, description: 'Phase updated successfully.' })
  @ApiResponse({ status: 404, description: 'Phase not found.' })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updatePhaseDto: UpdatePhaseDto,
  ) {
    return this.phasesService.update(id, req.user.userId, updatePhaseDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a phase' })
  @ApiResponse({ status: 200, description: 'Phase deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Phase not found.' })
  remove(@Request() req, @Param('id') id: string) {
    return this.phasesService.remove(id, req.user.userId);
  }
}
