import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { PhasesService } from '../phases/phases.service';
import type { Phase } from '../phases/entities/phase.entity';
import {
  parkedDays,
  ScheduleState,
  Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { localDateTimeIso, localYmd } from '../voice/voice-local-date.util';
import type {
  PlaceProblematicDto,
  PlaceProblematicResult,
} from './dto/place-problematic.dto';
import { PlacementStepService } from './placement-step.service';
import type { PlacementPlan } from './placement-step.util';

/** Park columns restored when the chosen slot does not seat. */
type ParkSnapshot = Pick<
  Task,
  | 'scheduleState'
  | 'problematicReason'
  | 'problematicDay'
  | 'problematicOccurrenceYmds'
  | 'problematicOriginalStart'
  | 'problematicOriginalEnd'
  | 'parentSeriesId'
  | 'phaseId'
  | 'phases'
  | 'scheduledStartTime'
  | 'scheduledEndTime'
  | 'earliestStartTime'
  | 'deadline'
  | 'isUnscheduled'
>;

/**
 * Problematic Move: seat one parked task (or one parked series day) on the
 * slot the user picked. One request, so a failed step cannot leave a copy
 * behind. The task keeps its type; a flexible stays flexible.
 */
@Injectable()
export class ProblematicPlaceService {
  private readonly logger = new Logger(ProblematicPlaceService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly tasksService: TasksService,
    private readonly placementStep: PlacementStepService,
    private readonly phasesService: PhasesService,
    private readonly userSettingsService: UserSettingsService,
  ) {}

  async place(
    userId: string,
    taskId: string,
    dto: PlaceProblematicDto,
  ): Promise<PlaceProblematicResult> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    if (!(end > start)) {
      throw new BadRequestException('Slot end must be after start.');
    }
    if (end.getTime() <= Date.now()) {
      throw new BadRequestException('Pick a time that has not passed.');
    }
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.scheduleState !== ScheduleState.PROBLEMATIC) {
      throw new BadRequestException('This task is not in Problematic.');
    }
    const minutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    );
    const phases =
      dto.phaseIds === undefined
        ? (task.phases ?? [])
        : await this.phasesFor(userId, dto.phaseIds);

    if (task.isRecurring) {
      if (!dto.occurrenceYmd) {
        throw new BadRequestException('Pick which series day to move.');
      }
      return this.placeSeriesDay(userId, task, dto.occurrenceYmd, {
        start,
        end,
        minutes,
        phases,
      });
    }
    return this.placeOneOff(userId, task, { start, end, minutes, phases });
  }

  private async placeOneOff(
    userId: string,
    task: Task,
    slot: SlotChoice,
  ): Promise<PlaceProblematicResult> {
    const snapshot = parkSnapshot(task);
    task.phases = slot.phases;
    task.phaseId = slot.phases[0]?.id ?? null;
    task.isUnscheduled = false;
    // Park metadata stays until the seat is written (persist clears it).
    task.scheduleState = ScheduleState.NONE;
    await this.taskRepo.save(task);

    const plan = await this.placeAt(userId, task.id, slot);
    if (seatedAt(plan, slot.start)) {
      return result(plan.mergedIntoTaskId ?? task.id, slot);
    }
    const fresh = await this.taskRepo.findOne({
      where: { id: task.id, userId },
      relations: ['phases'],
    });
    if (fresh) {
      Object.assign(fresh, snapshot);
      await this.taskRepo.save(fresh);
    }
    throw this.missed(task, slot, plan);
  }

  private async placeSeriesDay(
    userId: string,
    series: Task,
    occurrenceYmd: string,
    slot: SlotChoice,
  ): Promise<PlaceProblematicResult> {
    const copy = await this.taskRepo.save(
      this.taskRepo.create({
        userId,
        name: series.name,
        description: series.description,
        phaseId: slot.phases[0]?.id ?? null,
        phases: slot.phases,
        // The copy keeps the series type: a fixed series day stays fixed (PE-24).
        eventType: series.eventType,
        estimatedTimeInMinutes: slot.minutes,
        isRecurring: false,
        recurrencePattern: null,
        recurrenceWeekDays: null,
        allowSplit: series.allowSplit,
        priority: series.priority,
        scheduleTimeZone: series.scheduleTimeZone,
        status: TaskStatus.TODO,
        scheduledStartTime: null,
        scheduledEndTime: null,
        location: series.location,
        googleColorId: series.googleColorId,
        googleVisibility: series.googleVisibility,
        googleTransparency: series.googleTransparency,
        googleReminders: series.googleReminders,
        scheduleState: ScheduleState.NONE,
        isUnscheduled: false,
        parentSeriesId: series.id,
        seriesGroupId: series.seriesGroupId ?? series.id,
        originalOccurrenceYmd: occurrenceYmd,
      }),
    );

    const plan = await this.placeAt(userId, copy.id, slot);
    if (!seatedAt(plan, slot.start)) {
      await this.taskRepo.delete({ id: copy.id, userId });
      throw this.missed(series, slot, plan);
    }

    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(
      settings.timeZone || series.scheduleTimeZone,
    );
    if (plan.mergedIntoTaskId) {
      // The copy landed back on the series clock and merged into it: that
      // day is part of the series again, so it is answered, not skipped.
      await this.dropParkedDay(userId, series.id, occurrenceYmd, timeZone);
    } else {
      // Skipping a parked series day also drops it from the inbox.
      await this.tasksService.skipOccurrence(series.id, userId, {
        occurrenceStart: localDateTimeIso(occurrenceYmd, '12:00', timeZone),
      });
    }
    return result(plan.mergedIntoTaskId ?? copy.id, slot);
  }

  /** Remove one day from a parked series; the last day leaves the inbox. */
  private async dropParkedDay(
    userId: string,
    seriesId: string,
    occurrenceYmd: string,
    timeZone: string,
  ): Promise<void> {
    const series = await this.taskRepo.findOne({
      where: { id: seriesId, userId },
    });
    if (!series || series.scheduleState !== ScheduleState.PROBLEMATIC) return;
    const today = localYmd(new Date().toISOString(), timeZone);
    const remaining = parkedDays(series).filter(
      (ymd) => ymd !== occurrenceYmd && ymd >= today,
    );
    if (remaining.length) {
      series.problematicOccurrenceYmds = remaining;
      series.problematicDay = remaining[0];
      await this.taskRepo.save(series);
      return;
    }
    await this.tasksService.update(series.id, userId, {
      scheduleState: ScheduleState.NONE,
    });
  }

  private placeAt(userId: string, taskId: string, slot: SlotChoice) {
    // Same step as a calendar drag onto a free interval.
    return this.placementStep.place(userId, taskId, {
      preferredStart: slot.start,
      durationMinutes: slot.minutes,
      commit: 'preferred',
      drag: true,
    });
  }

  private async phasesFor(userId: string, phaseIds: string[]): Promise<Phase[]> {
    if (!phaseIds.length) return [];
    const own = await this.phasesService.findAllForScheduling(userId);
    const picked = own.filter((phase) => phaseIds.includes(phase.id));
    if (picked.length !== phaseIds.length) {
      throw new BadRequestException('Phases must belong to your account');
    }
    return picked;
  }

  private missed(task: Task, slot: SlotChoice, plan: PlacementPlan) {
    this.logger.warn(
      `[problematic-place] task=${task.id} "${task.name}" ` +
        `slot=${slot.start.toISOString()}–${slot.end.toISOString()} outcome=${plan.outcome}`,
    );
    return new BadRequestException(
      'That time is no longer free. Pick another slot.',
    );
  }
}

type SlotChoice = {
  start: Date;
  end: Date;
  minutes: number;
  phases: Phase[];
};

function seatedAt(
  plan: PlacementPlan,
  start: Date,
): plan is Extract<PlacementPlan, { outcome: 'seated' }> {
  return plan.outcome === 'seated' && Math.abs(plan.start - start.getTime()) < 1000;
}

function result(taskId: string, slot: SlotChoice): PlaceProblematicResult {
  return {
    taskId,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
  };
}

function parkSnapshot(task: Task): ParkSnapshot {
  return {
    scheduleState: task.scheduleState,
    problematicReason: task.problematicReason,
    problematicDay: task.problematicDay,
    problematicOccurrenceYmds: task.problematicOccurrenceYmds,
    problematicOriginalStart: task.problematicOriginalStart,
    problematicOriginalEnd: task.problematicOriginalEnd,
    parentSeriesId: task.parentSeriesId,
    phaseId: task.phaseId,
    phases: task.phases,
    scheduledStartTime: task.scheduledStartTime,
    scheduledEndTime: task.scheduledEndTime,
    earliestStartTime: task.earliestStartTime,
    deadline: task.deadline,
    isUnscheduled: task.isUnscheduled,
  };
}
