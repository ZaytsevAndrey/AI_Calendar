import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventPhase } from './event-phase.entity';
import { PhasesService } from '../phases/phases.service';

@Injectable()
export class EventPhasesService {
  constructor(
    @InjectRepository(EventPhase)
    private eventPhasesRepository: Repository<EventPhase>,
    private readonly phasesService: PhasesService,
  ) {}

  async create(
    eventId: string,
    phaseId: string,
    userId: string,
  ): Promise<EventPhase> {
    await this.phasesService.findOne(phaseId, userId);
    const eventPhase = this.eventPhasesRepository.create({
      eventId,
      phaseId,
      userId,
    });
    return this.eventPhasesRepository.save(eventPhase);
  }

  async findByEvent(
    eventId: string,
    userId: string,
  ): Promise<EventPhase | null> {
    return this.eventPhasesRepository.findOne({ where: { eventId, userId } });
  }

  async findByPhase(
    phaseId: string,
    userId: string,
  ): Promise<EventPhase[]> {
    return this.eventPhasesRepository.find({ where: { phaseId, userId } });
  }

  async update(
    id: string,
    userId: string,
    phaseId: string,
  ): Promise<EventPhase> {
    const eventPhase = await this.eventPhasesRepository.findOne({
      where: { id },
    });
    if (!eventPhase || eventPhase.userId !== userId) {
      throw new NotFoundException('EventPhase not found');
    }
    await this.phasesService.findOne(phaseId, userId);
    eventPhase.phaseId = phaseId;
    return this.eventPhasesRepository.save(eventPhase);
  }

  async remove(id: string, userId: string): Promise<void> {
    const eventPhase = await this.eventPhasesRepository.findOne({
      where: { id },
    });
    if (!eventPhase || eventPhase.userId !== userId) {
      throw new NotFoundException('EventPhase not found');
    }
    await this.eventPhasesRepository.delete(id);
  }
}
