import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import { Phase } from '../phases/entities/phase.entity';
import { PhasesService } from '../phases/phases.service';
import { EditOccurrenceDto } from '../tasks/dto/edit-occurrence.dto';
import { stampCompletion, Task, TaskStatus } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { localDateTimeIso, localHm, localYmd, normalizeClockHm } from '../voice/voice-local-date.util';
import { DisplayedEventMoveService } from './displayed-event-move.service';
import { PlacementStepService } from './placement-step.service';
import { ScheduleJobService } from './schedule-job.service';
import { ScheduledTask } from './schedule.entity';
import type { SchedulingConflict } from './scheduling-conflict.types';
import { findDayCopy, findOrCreateDayCopy, skipSeriesDay } from './series-exception.util';

export type OccurrenceEditResult = Task & {
  jobId: string | null;
  conflicts?: SchedulingConflict[];
};

/**
 * Edits of one day of a series, or of this day and the following ones,
 * that leave the rest of the series alone.
 *
 * One day: the day leaves the series (skip) and an identical one-off copy
 * takes its place — the domain's occurrence identity (series group + civil
 * day), so a retry finds the same copy, the day never comes back when the
 * horizon is appended, and the copy keeps `parentSeriesId` /
 * `originalOccurrenceYmd` as its lineage. The copy then carries the changed
 * name, notes, phase, time, duration or completion.
 *
 * Following: the series is split on that day (old series ends before it, a
 * new one with the changes starts on it) — the same split a drag of
 * "this and following" makes. A series with no history before the day is
 * edited whole instead, so no empty series is left behind.
 */
@Injectable()
export class OccurrenceEditService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    private readonly placementStep: PlacementStepService,
    private readonly phasesService: PhasesService,
    private readonly userSettingsService: UserSettingsService,
    private readonly pendingGoogleWrites: PendingGoogleWriteService,
    private readonly scheduleJobs: ScheduleJobService,
    private readonly moveService: DisplayedEventMoveService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
  ) {}

  async edit(seriesId: string, userId: string, dto: EditOccurrenceDto): Promise<OccurrenceEditResult> {
    const series = await this.taskRepo.findOne({
      where: { id: seriesId, userId },
      relations: ['phase', 'phases'],
    });
    if (!series) throw new NotFoundException('Task not found');
    if (!series.isRecurring) {
      throw new BadRequestException('Only a series has occurrences; edit the task itself.');
    }
    if (series.status === TaskStatus.COMPLETED || series.status === TaskStatus.CANCELED) {
      throw new BadRequestException('Completed or canceled series cannot be edited this way');
    }
    const occurrenceStart = new Date(dto.occurrenceStart);
    if (Number.isNaN(occurrenceStart.getTime())) {
      throw new BadRequestException('occurrenceStart must be a valid ISO date');
    }
    const settings = await this.userSettingsService.getSettings(userId);
    const timeZone = resolveIanaTimeZone(settings.timeZone || series.scheduleTimeZone);
    const ymd = localYmd(occurrenceStart.toISOString(), timeZone);

    let newStart: Date | null = null;
    if (dto.start !== undefined) {
      newStart = new Date(dto.start);
      if (Number.isNaN(newStart.getTime())) {
        throw new BadRequestException('start must be a valid ISO date');
      }
      if (localYmd(newStart.toISOString(), timeZone) !== ymd) {
        throw new BadRequestException('An occurrence can only move within its own day.');
      }
    }

    const scope = dto.scope ?? 'occurrence';
    if (scope === 'following') {
      if (dto.status !== undefined) {
        throw new BadRequestException('Completion applies to one occurrence, not to the following ones.');
      }
      return this.editFollowing(series, userId, timeZone, ymd, occurrenceStart, newStart, dto);
    }
    return this.editOne(series, userId, timeZone, ymd, occurrenceStart, newStart, dto);
  }

  // ---------------------------------------------------------------- one day

  private async editOne(
    series: Task,
    userId: string,
    timeZone: string,
    ymd: string,
    occurrenceStart: Date,
    newStart: Date | null,
    dto: EditOccurrenceDto,
  ): Promise<OccurrenceEditResult> {
    const rows = await this.scheduledRepo.find({ where: { taskId: series.id } });
    const dayRows = rows.filter(
      (row) => localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone) === ymd,
    );
    const row =
      dayRows.find(
        (r) => Math.abs(new Date(r.scheduledStartTime).getTime() - occurrenceStart.getTime()) < 60_000,
      ) ?? dayRows[0] ?? null;

    if (!row) {
      // The day is already a one-off copy (an earlier edit, a move, a conflict):
      // the edit belongs to that copy.
      const copy = await findDayCopy(
        { tasks: this.taskRepo, slots: this.scheduledRepo },
        series,
        ymd,
      );
      if (copy) return this.editExistingCopy(copy, userId, newStart, dto);
      throw new BadRequestException('There is no occurrence of this series on that day.');
    }

    const now = Date.now();
    const rowStart = new Date(row.scheduledStartTime);
    const rowEnd = new Date(row.scheduledEndTime);
    const rowMinutes = Math.max(1, Math.round((rowEnd.getTime() - rowStart.getTime()) / 60_000));
    const start = newStart ?? rowStart;
    const minutes = dto.durationMinutes ?? rowMinutes;
    const end = new Date(start.getTime() + minutes * 60_000);
    const timeChanged = start.getTime() !== rowStart.getTime() || minutes !== rowMinutes;
    const open = rowEnd.getTime() > now;
    if (timeChanged && !open) {
      throw new BadRequestException('A past occurrence cannot be moved.');
    }

    const onlyStatus =
      dto.name === undefined &&
      dto.description === undefined &&
      dto.phaseIds === undefined &&
      !timeChanged;
    if (onlyStatus && (dto.status === undefined || dto.status === 'todo')) {
      // Nothing to change: the series day is already a "to do" occurrence.
      return Object.assign(series, { jobId: null });
    }

    const phases = await this.resolvePhases(userId, dto.phaseIds, series);
    const job = await this.scheduleJobs.beginMutationJob(
      userId,
      { op: 'edit_occurrence', taskId: series.id, seriesScope: 'occurrence' },
      { inline: true },
    );

    const applyFields = (copy: Task) => {
      if (dto.name !== undefined) copy.name = dto.name.trim() || copy.name;
      if (dto.description !== undefined) copy.description = dto.description ?? (null as unknown as string);
      if (dto.status !== undefined) {
        const previous = copy.status;
        copy.status = dto.status === 'completed' ? TaskStatus.COMPLETED : TaskStatus.TODO;
        stampCompletion(copy, previous);
      }
    };

    if (timeChanged) {
      // New interval: the copy is seated by the engine (peers it lands on move),
      // in one transaction with the skip. A conflict rolls everything back.
      const out = await this.placementStep.writeAndPlace(
        userId,
        async (repos) => {
          const fresh = await repos.tasks.findOneOrFail({ where: { id: series.id, userId } });
          if (!fresh.seriesGroupId) fresh.seriesGroupId = fresh.id;
          await skipSeriesDay(repos, fresh, ymd, timeZone, new Date());
          const copy = await findOrCreateDayCopy(repos, fresh, ymd, { start, end, minutes, phases });
          applyFields(copy);
          await repos.tasks.save(copy);
          return {
            taskId: copy.id,
            opts: { preferredStart: start, durationMinutes: minutes, drag: true },
          };
        },
        (plan) => plan.outcome !== 'conflict',
      );
      if (!out.committed) {
        const conflicts = out.plan.outcome === 'conflict' ? [out.plan.conflict] : undefined;
        await this.scheduleJobs.completeMutationJob(job.id, conflicts ? { conflicts } : undefined);
        return Object.assign(series, { jobId: job.id, conflicts });
      }
      await this.scheduleJobs.setMutationStage(job.id, 'syncing');
      await this.pendingGoogleWrites.syncTask(userId, series.id);
      const seatedId =
        out.plan.outcome === 'seated' ? out.plan.mergedIntoTaskId ?? out.taskId : out.taskId;
      await this.pendingGoogleWrites.syncTask(userId, seatedId);
      await this.placementStep.seatOpenHoles(userId);
      await this.scheduleJobs.completeMutationJob(job.id);
      const copy = await this.taskRepo.findOne({ where: { id: seatedId, userId }, relations: ['phase', 'phases'] });
      return Object.assign(copy ?? series, { jobId: job.id });
    }

    // Same interval (a rename, notes, phase, completion): the copy takes the
    // series row's place as it is — no placement, nothing else moves. Works
    // for a past day too, which is how one day's completion is recorded.
    const copyId = await this.placementStep.runExclusive(userId, () =>
      this.taskRepo.manager.transaction(async (manager) => {
        const repos = { tasks: manager.getRepository(Task), slots: manager.getRepository(ScheduledTask) };
        const fresh = await repos.tasks.findOneOrFail({ where: { id: series.id, userId } });
        if (!fresh.seriesGroupId) fresh.seriesGroupId = fresh.id;
        await skipSeriesDay(repos, fresh, ymd, timeZone, new Date());
        // A past day's row is history on the series; it now belongs to the copy.
        const left = (await repos.slots.find({ where: { taskId: fresh.id } })).filter(
          (r) => localYmd(new Date(r.scheduledStartTime).toISOString(), timeZone) === ymd,
        );
        if (left.length) await repos.slots.remove(left);
        const copy = await findOrCreateDayCopy(repos, fresh, ymd, {
          start: rowStart,
          end: rowEnd,
          minutes: rowMinutes,
          phases,
        });
        applyFields(copy);
        await repos.tasks.save(copy);
        const copyRows = await repos.slots.find({ where: { taskId: copy.id } });
        if (copyRows.length) await repos.slots.remove(copyRows);
        await repos.slots.save(
          repos.slots.create({
            taskId: copy.id,
            scheduledStartTime: rowStart,
            scheduledEndTime: rowEnd,
            isAutoGenerated: true,
          }),
        );
        return copy.id;
      }),
    );
    await this.scheduleJobs.setMutationStage(job.id, 'syncing');
    await this.pendingGoogleWrites.syncTask(userId, series.id);
    await this.pendingGoogleWrites.syncTask(userId, copyId);
    await this.scheduleJobs.completeMutationJob(job.id);
    const copy = await this.taskRepo.findOne({ where: { id: copyId, userId }, relations: ['phase', 'phases'] });
    return Object.assign(copy ?? series, { jobId: job.id });
  }

  /** The day is already a copy: the ordinary task edits apply to it. */
  private async editExistingCopy(
    copy: Task,
    userId: string,
    newStart: Date | null,
    dto: EditOccurrenceDto,
  ): Promise<OccurrenceEditResult> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.phaseIds !== undefined) patch.phaseIds = dto.phaseIds;
    if (dto.status !== undefined) {
      patch.status = dto.status === 'completed' ? TaskStatus.COMPLETED : TaskStatus.TODO;
    }
    const start = newStart ?? (copy.scheduledStartTime ? new Date(copy.scheduledStartTime) : null);
    const minutes = dto.durationMinutes ?? copy.estimatedTimeInMinutes;
    if ((newStart || dto.durationMinutes !== undefined) && start) {
      patch.scheduledStartTime = start.toISOString();
      patch.scheduledEndTime = new Date(start.getTime() + minutes * 60_000).toISOString();
      patch.estimatedTimeInMinutes = minutes;
    }
    if (!Object.keys(patch).length) return Object.assign(copy, { jobId: null });
    return this.tasksService.update(copy.id, userId, patch as never);
  }

  // -------------------------------------------------------- this and following

  private async editFollowing(
    series: Task,
    userId: string,
    timeZone: string,
    ymd: string,
    occurrenceStart: Date,
    newStart: Date | null,
    dto: EditOccurrenceDto,
  ): Promise<OccurrenceEditResult> {
    const rows = await this.scheduledRepo.find({ where: { taskId: series.id } });
    const dayRow =
      rows.find(
        (r) => localYmd(new Date(r.scheduledStartTime).toISOString(), timeZone) === ymd,
      ) ?? null;
    const currentStart = dayRow
      ? new Date(dayRow.scheduledStartTime)
      : series.scheduledStartTime
        ? new Date(
            localDateTimeIso(
              ymd,
              normalizeClockHm(localHm(new Date(series.scheduledStartTime).toISOString(), timeZone)),
              timeZone,
            ),
          )
        : occurrenceStart;
    const currentMinutes = dayRow
      ? Math.max(
          1,
          Math.round(
            (new Date(dayRow.scheduledEndTime).getTime() - new Date(dayRow.scheduledStartTime).getTime()) /
              60_000,
          ),
        )
      : series.estimatedTimeInMinutes;
    const start = newStart ?? currentStart;
    const minutes = dto.durationMinutes ?? currentMinutes;
    const phases = await this.resolvePhases(userId, dto.phaseIds, series);
    const phaseIds = phases.map((p) => p.id);

    const hasHistoryBefore = rows.some(
      (r) => localYmd(new Date(r.scheduledStartTime).toISOString(), timeZone) < ymd,
    );
    if (!hasHistoryBefore) {
      // Nothing before this day: the whole series is "this and following".
      const patch: Record<string, unknown> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.description !== undefined) patch.description = dto.description;
      if (dto.phaseIds !== undefined) patch.phaseIds = dto.phaseIds;
      if (newStart || dto.durationMinutes !== undefined) {
        patch.scheduledStartTime = start.toISOString();
        patch.scheduledEndTime = new Date(start.getTime() + minutes * 60_000).toISOString();
        patch.estimatedTimeInMinutes = minutes;
      }
      if (!Object.keys(patch).length) return Object.assign(series, { jobId: null });
      return this.tasksService.update(series.id, userId, patch as never);
    }

    const job = await this.scheduleJobs.beginMutationJob(
      userId,
      { op: 'edit_series_following', taskId: series.id, seriesScope: 'series' },
      { inline: true },
    );
    const tailId = await this.moveService.editSeriesFollowing(
      userId,
      series,
      occurrenceStart,
      start,
      minutes,
      phaseIds,
      { name: dto.name, description: dto.description },
    );
    await this.scheduleJobs.completeMutationJob(job.id);
    const tail = await this.taskRepo.findOne({ where: { id: tailId, userId }, relations: ['phase', 'phases'] });
    return Object.assign(tail ?? series, { jobId: job.id });
  }

  private async resolvePhases(
    userId: string,
    phaseIds: string[] | undefined,
    series: Task,
  ): Promise<Phase[]> {
    if (phaseIds === undefined) {
      const linked = series.phases?.length ? series.phases : series.phase ? [series.phase] : [];
      return linked;
    }
    if (!phaseIds.length) return [];
    const all = await this.phasesService.findAllForScheduling(userId);
    const picked = all.filter((p) => phaseIds.includes(p.id));
    if (picked.length !== phaseIds.length) {
      throw new BadRequestException('One or more phase IDs are invalid');
    }
    return picked;
  }
}
