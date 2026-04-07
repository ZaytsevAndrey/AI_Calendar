import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Phase } from './entities/phase.entity';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

@Injectable()
export class PhasesService {
  constructor(
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
  ) {}

  /**
   * Creates default sleep + focus (wake→sleep) phases from user settings when the user has none.
   * Sleep window uses overnight span (sleepTime → wakeTime), same convention as the scheduler.
   */
  async ensureDefaultPhasesForUser(
    userId: string,
    wakeTime: string,
    sleepTime: string,
  ): Promise<void> {
    const n = await this.phasesRepository.count({ where: { userId } });
    if (n > 0) return;

    const sleep = this.phasesRepository.create({
      userId,
      name: 'Sleep',
      color: '#34495e',
      description: 'Rest (from your sleep → wake settings)',
      startTime: sleepTime,
      endTime: wakeTime,
      type: 'sleep_time',
    });
    const focus = this.phasesRepository.create({
      userId,
      name: 'Focus hours',
      color: '#2980b9',
      description: 'Main working window (wake → sleep from settings)',
      startTime: wakeTime,
      endTime: sleepTime,
      type: 'time_phase',
    });
    await this.phasesRepository.save([sleep, focus]);
  }

  private checkPhaseOverlap(
    userId: string,
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
      .where('phase.userId = :userId', { userId })
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
              (startMinutes >= catStartMinutes &&
                startMinutes < catEndMinutes) ||
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

  async create(
    userId: string,
    createPhaseDto: CreatePhaseDto,
  ): Promise<Phase> {
    const overlappingPhase = await this.checkPhaseOverlap(
      userId,
      createPhaseDto.startTime,
      createPhaseDto.endTime,
      createPhaseDto.weekDays || [],
    );
    if (overlappingPhase) {
      throw new BadRequestException(
        `Phase overlaps with "${overlappingPhase.name}" (${overlappingPhase.startTime}-${overlappingPhase.endTime})`,
      );
    }
    const phase = this.phasesRepository.create({
      ...createPhaseDto,
      userId,
    });
    return this.phasesRepository.save(phase);
  }

  async findAll(userId: string): Promise<Phase[]> {
    const n = await this.phasesRepository.count({ where: { userId } });
    if (n === 0) {
      const settings = await this.userSettingsRepository.findOne({
        where: { userId },
      });
      await this.ensureDefaultPhasesForUser(
        userId,
        settings?.wakeTime ?? '07:00',
        settings?.sleepTime ?? '22:00',
      );
    }
    return this.phasesRepository.find({
      where: { userId },
      order: { name: 'ASC' },
      relations: ['subphases', 'tasks'],
    });
  }

  async findOne(id: string, userId: string): Promise<Phase> {
    const phase = await this.phasesRepository.findOne({
      where: { id, userId },
      relations: ['tasks', 'subphases'],
    });
    if (!phase) {
      throw new NotFoundException(`Phase with ID ${id} not found`);
    }
    return phase;
  }

  async update(
    id: string,
    userId: string,
    updatePhaseDto: UpdatePhaseDto,
  ): Promise<Phase> {
    const phase = await this.findOne(id, userId);
    const overlappingPhase = await this.checkPhaseOverlap(
      userId,
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

  async remove(id: string, userId: string): Promise<void> {
    const phase = await this.findOne(id, userId);
    if (phase.tasks && phase.tasks.length > 0) {
      throw new NotFoundException(`Cannot delete phase with assigned tasks`);
    }
    await this.phasesRepository.remove(phase);
  }

  async getTimePhases(userId: string): Promise<Phase[]> {
    const phases = await this.findAll(userId);
    return phases.filter((phase) => phase.type === 'time_phase');
  }

  async getTimePhasesForDate(userId: string, date: Date): Promise<Phase[]> {
    const allPhases = await this.getTimePhases(userId);
    const dayOfWeek = date.getDay();
    return allPhases.filter(
      (phase) =>
        !phase.weekDays ||
        phase.weekDays.length === 0 ||
        phase.weekDays.includes(dayOfWeek),
    );
  }

  async getSleepTimePhases(userId: string): Promise<Phase[]> {
    const phases = await this.findAll(userId);
    return phases.filter((phase) => phase.type === 'sleep_time');
  }
}
