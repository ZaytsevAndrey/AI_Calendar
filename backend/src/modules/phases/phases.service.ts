import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Phase } from './entities/phase.entity';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { Task } from '../tasks/entities/task.entity';
import { EventPhase } from '../event-phases/event-phase.entity';
import {
  buildLifestylePresetBlocks,
  PHASE_PRESET_IDS,
  PhasePresetId,
} from './lifestyle-presets';
import { isAppLanguage, t, type AppLanguage } from '../../i18n';

@Injectable()
export class PhasesService {
  private static readonly LEGACY_MAIN_PHASE_NAME = 'Focus hours';

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

  private isSystemMainPhase(phase: Phase): boolean {
    return (
      phase.type === 'main_phase' ||
      (phase.type === 'time_phase' &&
        phase.name === PhasesService.LEGACY_MAIN_PHASE_NAME)
    );
  }

  private phaseLanguage(settings?: UserSettings | null): AppLanguage {
    return isAppLanguage(settings?.language) ? settings.language : 'en';
  }

  private basePhaseRows(
    userId: string,
    wakeTime: string,
    sleepTime: string,
    weekDays: number[] | null,
    language: AppLanguage = 'en',
  ) {
    return [
      {
        userId,
        name: t(language, 'preset.sleep.name'),
        color: '#34495e',
        description:
          language === 'uk'
            ? 'Відпочинок (зі налаштувань сон → підйом)'
            : 'Rest (from your sleep → wake settings)',
        startTime: sleepTime,
        endTime: wakeTime,
        type: 'sleep_time',
        weekDays,
      },
      {
        userId,
        name: t(language, 'preset.focus.name'),
        color: '#2980b9',
        description:
          language === 'uk'
            ? 'Основне робоче вікно (підйом → сон зі налаштувань)'
            : 'Main working window (wake → sleep from settings)',
        startTime: wakeTime,
        endTime: sleepTime,
        type: 'main_phase',
        weekDays,
      },
    ];
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

    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    const rows = this.basePhaseRows(
      userId,
      wakeTime,
      sleepTime,
      this.normalizeWeekDays(weekDays),
      this.phaseLanguage(settings),
    );
    await this.phasesRepository.save(
      rows.map((row) => this.phasesRepository.create(row)),
    );
  }

  /**
   * Replace every phase with Sleep, hidden Focus, and a lifestyle preset.
   * Refuses when any phase still has tasks (direct `phaseId` or `task_phases`).
   */
  async applyPreset(
    userId: string,
    presetId: PhasePresetId,
    weekDays?: number[] | null,
  ): Promise<Phase[]> {
    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    if (!settings) {
      throw new BadRequestException('User settings not found');
    }
    if (!(PHASE_PRESET_IDS as readonly string[]).includes(presetId)) {
      throw new BadRequestException('Unknown phase preset');
    }

    const wd = this.normalizeWeekDays(weekDays);
    const blocks = buildLifestylePresetBlocks(
      presetId,
      settings.wakeTime,
      settings.sleepTime,
      settings.language,
    );

    await this.phasesRepository.manager.transaction(async (manager) => {
      const phaseRepo = manager.getRepository(Phase);
      const existing = await phaseRepo.find({
        where: { userId },
        select: ['id'],
      });
      if (existing.length > 0) {
        const ids = existing.map((phase) => phase.id);
        const assigned = await manager
          .getRepository(Task)
          .createQueryBuilder('task')
          .leftJoin('task.phases', 'linkedPhase')
          .where('task.userId = :userId', { userId })
          .andWhere(
            '(task.phaseId IN (:...ids) OR linkedPhase.id IN (:...ids))',
            { ids },
          )
          .getCount();
        if (assigned > 0) {
          throw new BadRequestException(
            'Cannot apply a preset while a phase has tasks. Move or delete those tasks first.',
          );
        }
        await manager.delete(EventPhase, { userId });
        await phaseRepo.update({ userId }, { parentPhaseId: null });
        await phaseRepo.delete({ userId });
      }

      const rows = [
        ...this.basePhaseRows(
          userId,
          settings.wakeTime,
          settings.sleepTime,
          wd,
          this.phaseLanguage(settings),
        ),
        ...blocks.map((block) => ({
          userId,
          name: block.name,
          color: block.color,
          description: block.description,
          startTime: block.startTime,
          endTime: block.endTime,
          type: 'time_phase',
          weekDays: wd,
        })),
      ];
      await phaseRepo.save(rows.map((row) => phaseRepo.create(row)));
    });

    return this.findAll(userId);
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
    return this.findAll(userId);
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
    const phases = await this.phasesRepository.find({
      where: { userId },
      order: { name: 'ASC' },
      relations: ['subphases', 'tasks'],
    });
    return phases.filter((phase) => !this.isSystemMainPhase(phase));
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
      throw new ConflictException('Cannot delete phase with assigned tasks');
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
