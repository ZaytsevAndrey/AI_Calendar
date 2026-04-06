import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventPhase } from './event-phase.entity';

@Injectable()
export class EventPhasesService {
  constructor(
    @InjectRepository(EventPhase)
    private eventPhasesRepository: Repository<EventPhase>,
  ) {}

  async create(eventId: string, phaseId: string, userId: string): Promise<EventPhase> {
    const eventPhase = this.eventPhasesRepository.create({ eventId, phaseId, userId });
    return this.eventPhasesRepository.save(eventPhase);
  }

  async findByEvent(eventId: string, userId: string): Promise<EventPhase | null> {
    return this.eventPhasesRepository.findOne({ where: { eventId, userId } });
  }

  async findByPhase(phaseId: string, userId: string): Promise<EventPhase[]> {
    return this.eventPhasesRepository.find({ where: { phaseId, userId } });
  }

  async update(id: string, phaseId: string): Promise<EventPhase> {
    const eventPhase = await this.eventPhasesRepository.findOne({ where: { id } });
    if (!eventPhase) throw new NotFoundException('EventPhase not found');
    eventPhase.phaseId = phaseId;
    return this.eventPhasesRepository.save(eventPhase);
  }

  async remove(id: string): Promise<void> {
    await this.eventPhasesRepository.delete(id);
  }
} 