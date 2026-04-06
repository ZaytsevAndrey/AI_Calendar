import { Controller, Post, Body, Get, Param, Patch, Delete, Request, UseGuards } from '@nestjs/common';
import { EventPhasesService } from './event-phases.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('event-phases')
@UseGuards(JwtAuthGuard)
export class EventPhasesController {
  constructor(private readonly eventPhasesService: EventPhasesService) {}

  @Post()
  create(@Request() req, @Body() body: { eventId: string; phaseId: string }) {
    return this.eventPhasesService.create(body.eventId, body.phaseId, req.user.userId);
  }

  @Get('event/:eventId')
  findByEvent(@Request() req, @Param('eventId') eventId: string) {
    return this.eventPhasesService.findByEvent(eventId, req.user.userId);
  }

  @Get('phase/:phaseId')
  findByPhase(@Request() req, @Param('phaseId') phaseId: string) {
    return this.eventPhasesService.findByPhase(phaseId, req.user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { phaseId: string }) {
    return this.eventPhasesService.update(id, body.phaseId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.eventPhasesService.remove(id);
  }
} 