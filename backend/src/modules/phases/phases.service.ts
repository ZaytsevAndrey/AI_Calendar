import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Phase } from './entities/phase.entity';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';

@Injectable()
export class PhasesService {
  constructor(
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
  ) {}

  private checkPhaseOverlap(
    startTime: string,
    endTime: string,
    weekDays: number[],
    excludeId?: string,
  ): Promise<Phase | null> {
    const timeToMinutes = (time: string) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    return this.phasesRepository
      .createQueryBuilder('phase')
      .andWhere(excludeId ? 'phase.id != :excludeId' : '1=1', excludeId ? { excludeId } : {})
      .getMany()
      .then((phases) => {
        for (const phase of phases) {
          const hasCommonDays = weekDays.some(
            (day) =>
              !phase.weekDays ||
              phase.weekDays.length === 0 ||
              phase.weekDays.includes(day),
          );
          if (hasCommonDays) {
            const catStartMinutes = timeToMinutes(phase.startTime);
            const catEndMinutes = timeToMinutes(phase.endTime);
            if (
              (startMinutes >= catStartMinutes && startMinutes < catEndMinutes) ||
              (endMinutes > catStartMinutes && endMinutes <= catEndMinutes) ||
              (startMinutes <= catStartMinutes && endMinutes >= catEndMinutes)
            ) {
              return phase;
            }
          }
        }
        return null;
      });
  }

  async create(createPhaseDto: CreatePhaseDto): Promise<Phase> {
    const overlappingPhase = await this.checkPhaseOverlap(
      createPhaseDto.startTime,
      createPhaseDto.endTime,
      createPhaseDto.weekDays || [],
    );
    if (overlappingPhase) {
      throw new BadRequestException(
        `Phase overlaps with "${overlappingPhase.name}" (${overlappingPhase.startTime}-${overlappingPhase.endTime})`,
      );
    }
    const phase = this.phasesRepository.create({ ...createPhaseDto });
    return this.phasesRepository.save(phase);
  }

  async findAll(): Promise<Phase[]> {
    return this.phasesRepository.find({
      order: { name: 'ASC' },
      relations: ['subphases', 'tasks'],
    });
  }

  async findOne(id: string): Promise<Phase> {
    const phase = await this.phasesRepository.findOne({
      where: { id },
      relations: ['tasks', 'subphases'],
    });
    if (!phase) {
      throw new NotFoundException(`Phase with ID ${id} not found`);
    }
    return phase;
  }

  async update(id: string, updatePhaseDto: UpdatePhaseDto): Promise<Phase> {
    const phase = await this.findOne(id);
    const overlappingPhase = await this.checkPhaseOverlap(
      updatePhaseDto.startTime || phase.startTime,
      updatePhaseDto.endTime || phase.endTime,
      updatePhaseDto.weekDays || phase.weekDays || [],
      id,
    );
    if (overlappingPhase) {
      throw new BadRequestException(
        `Phase overlaps with "${overlappingPhase.name}" (${overlappingPhase.startTime}-${overlappingPhase.endTime})`,
      );
    }
    const updatedPhase = this.phasesRepository.merge(phase, updatePhaseDto);
    return this.phasesRepository.save(updatedPhase);
  }

  async remove(id: string): Promise<void> {
    const phase = await this.findOne(id);
    if (phase.tasks && phase.tasks.length > 0) {
      throw new NotFoundException(`Cannot delete phase with assigned tasks`);
    }
    await this.phasesRepository.remove(phase);
  }

  async getTimePhases(): Promise<Phase[]> {
    const phases = await this.findAll();
    return phases.filter((phase) => phase.type === 'time_phase');
  }

  async getTimePhasesForDate(date: Date): Promise<Phase[]> {
    const allPhases = await this.getTimePhases();
    const dayOfWeek = date.getDay();
    return allPhases.filter((phase) =>
      !phase.weekDays || phase.weekDays.length === 0 || phase.weekDays.includes(dayOfWeek)
    );
  }

  async getSleepTimePhases(): Promise<Phase[]> {
    const phases = await this.findAll();
    return phases.filter((phase) => phase.type === 'sleep_time');
  }
} 