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

  /** Normalize weekdays for persistence; empty array means all days (`null`). */
  private normalizeWeekDays(weekDays?: number[] | null): number[] | null {
    if (!weekDays?.length) return null;
    return [...new Set(weekDays)].sort((a, b) => a - b);
  }

  /**
   * Internal: creates Sleep + Focus when no phases exist yet. Called from `setupDefaultPhases`.
   */
  async ensureDefaultPhasesForUser(
    userId: string,
    wakeTime: string,
    sleepTime: string,
    weekDays?: number[] | null,
  ): Promise<void> {
    const n = await this.phasesRepository.count({ where: { userId } });
    if (n > 0) return;

    const wd = this.normalizeWeekDays(weekDays);

    const sleep = this.phasesRepository.create({
      userId,
      name: 'Sleep',
      color: '#34495e',
      description: 'Rest (from your sleep → wake settings)',
      startTime: sleepTime,
      endTime: wakeTime,
      type: 'sleep_time',
      weekDays: wd,
    });
    const focus = this.phasesRepository.create({
      userId,
      name: 'Focus hours',
      color: '#2980b9',
      description: 'Main working window (wake → sleep from settings)',
      startTime: wakeTime,
      endTime: sleepTime,
      type: 'time_phase',
      weekDays: wd,
    });
    await this.phasesRepository.save([sleep, focus]);
  }

  /** Creates Sleep + Focus from user settings when the user has no phases (first-time setup). */
  async setupDefaultPhases(
    userId: string,
    weekDays?: number[] | null,
  ): Promise<Phase[]> {
    const n = await this.phasesRepository.count({ where: { userId } });
    if (n > 0) {
      throw new BadRequestException('Phases already exist for this user');
    }
    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    if (!settings) {
      throw new BadRequestException('User settings not found');
    }
    await this.ensureDefaultPhasesForUser(
      userId,
      settings.wakeTime,
      settings.sleepTime,
      weekDays ?? null,
    );
    return this.phasesRepository.find({
      where: { userId },
      order: { name: 'ASC' },
      relations: ['subphases', 'tasks'],
    });
  }

  countForUser(userId: string): Promise<number> {
    return this.phasesRepository.count({ where: { userId } });
  }

  async create(
    userId: string,
    createPhaseDto: CreatePhaseDto,
  ): Promise<Phase> {
    const phase = this.phasesRepository.create({
      ...createPhaseDto,
      userId,
      weekDays: this.normalizeWeekDays(createPhaseDto.weekDays ?? null),
    });
    return this.phasesRepository.save(phase);
  }

  async findAll(userId: string): Promise<Phase[]> {
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
    const updatedPhase = this.phasesRepository.merge(phase, updatePhaseDto);
    if (
      updatePhaseDto.weekDays !== undefined &&
      (!updatePhaseDto.weekDays || updatePhaseDto.weekDays.length === 0)
    ) {
      updatedPhase.weekDays = null;
    }
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
