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
import { UserSettingsService } from '../user-settings/user-settings.service';
import type {
  PlaceProblematicDto,
  PlaceProblematicResult,
} from './dto/place-problematic.dto';
import { PlacementStepService, type PlaceOptions } from './placement-step.service';
import { findOrCreateDayCopy, skipSeriesDay } from './series-exception.util';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import type { PlacementPlan } from './placement-step.util';

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
    private readonly placementStep: PlacementStepService,
    private readonly phasesService: PhasesService,
    private readonly userSettingsService: UserSettingsService,
    private readonly pendingGoogleWrites: PendingGoogleWriteService,
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
    // PE-18: the new phase / state and the seat are one transaction; a miss
    // rolls both back, so the task stays parked exactly as it was.
    const out = await this.placementStep.writeAndPlace(
      userId,
      async ({ tasks }) => {
        const fresh = await tasks.findOneOrFail({
          where: { id: task.id, userId },
          relations: ['phases'],
        });
        fresh.phases = slot.phases;
        fresh.phaseId = slot.phases[0]?.id ?? null;
        fresh.isUnscheduled = false;
        // Park metadata stays until the seat is written (persist clears it).
        fresh.scheduleState = ScheduleState.NONE;
        await tasks.save(fresh);
        return { taskId: fresh.id, opts: placeAtOptions(slot) };
      },
      (plan) => seatedAt(plan, slot.start),
    );
    if (!out.committed) throw this.missed(task, slot, out.plan);
    return result(seatedTaskId(out.plan, task.id), slot);
  }

  private async placeSeriesDay(
    userId: string,
    series: Task,
    occurrenceYmd: string,
    slot: SlotChoice,
  ): Promise<PlaceProblematicResult> {
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(
      settings.timeZone || series.scheduleTimeZone,
    );
    // PE-18: skip the day (which also answers it in the inbox), make or reuse
    // its copy, and seat the copy — one transaction. Taken slot: nothing stays.
    // A copy that lands back on the series clock re-merges and un-skips the day.
    const out = await this.placementStep.writeAndPlace(
      userId,
      async (repos) => {
        const fresh = await repos.tasks.findOneOrFail({
          where: { id: series.id, userId },
        });
        if (!fresh.seriesGroupId) fresh.seriesGroupId = fresh.id;
        await skipSeriesDay(repos, fresh, occurrenceYmd, timeZone, new Date());
        const copy = await findOrCreateDayCopy(repos, fresh, occurrenceYmd, slot);
        return { taskId: copy.id, opts: placeAtOptions(slot) };
      },
      (plan) => seatedAt(plan, slot.start),
    );
    if (!out.committed) throw this.missed(series, slot, out.plan);
    // New EXDATE / DTSTART for the series on Google, after the commit.
    await this.pendingGoogleWrites.syncTask(userId, series.id);
    return result(seatedTaskId(out.plan, out.taskId), slot);
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

/** Same step as a calendar drag onto a free interval. */
function placeAtOptions(slot: SlotChoice): PlaceOptions {
  return {
    preferredStart: slot.start,
    durationMinutes: slot.minutes,
    commit: 'preferred',
    drag: true,
  };
}

/** The task that ended up on the slot (the series, when the copy re-merged). */
function seatedTaskId(plan: PlacementPlan, fallback: string): string {
  return plan.outcome === 'seated' ? plan.mergedIntoTaskId ?? fallback : fallback;
}
