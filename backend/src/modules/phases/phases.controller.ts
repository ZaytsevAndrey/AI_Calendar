import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PhasesService } from './phases.service';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';

@ApiTags('phases')
@Controller('phases')
export class PhasesController {
  constructor(private readonly phasesService: PhasesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new phase' })
  @ApiResponse({ status: 201, description: 'Phase created successfully.' })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  create(@Body() createPhaseDto: CreatePhaseDto) {
    return this.phasesService.create(createPhaseDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all phases' })
  @ApiResponse({ status: 200, description: 'Return all phases.' })
  findAll() {
    return this.phasesService.findAll();
  }

  @Get('time-phases')
  @ApiOperation({ summary: 'Get time phases' })
  @ApiResponse({ status: 200, description: 'Return time phases.' })
  getTimePhases() {
    return this.phasesService.getTimePhases();
  }

  @Get('time-phases/date/:date')
  @ApiOperation({ summary: 'Get time phases for specific date' })
  @ApiResponse({ status: 200, description: 'Return time phases for date.' })
  getTimePhasesForDate(@Param('date') date: string) {
    return this.phasesService.getTimePhasesForDate(new Date(date));
  }

  @Get('sleep-time')
  @ApiOperation({ summary: 'Get sleep time phases' })
  @ApiResponse({ status: 200, description: 'Return sleep time phases.' })
  getSleepTimePhases() {
    return this.phasesService.getSleepTimePhases();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a phase by id' })
  @ApiResponse({ status: 200, description: 'Return the phase.' })
  @ApiResponse({ status: 404, description: 'Phase not found.' })
  findOne(@Param('id') id: string) {
    return this.phasesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a phase' })
  @ApiResponse({ status: 200, description: 'Phase updated successfully.' })
  @ApiResponse({ status: 404, description: 'Phase not found.' })
  update(@Param('id') id: string, @Body() updatePhaseDto: UpdatePhaseDto) {
    return this.phasesService.update(id, updatePhaseDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a phase' })
  @ApiResponse({ status: 200, description: 'Phase deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Phase not found.' })
  remove(@Param('id') id: string) {
    return this.phasesService.remove(id);
  }
} 