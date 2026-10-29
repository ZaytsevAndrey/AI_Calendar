import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduleJob } from './entities/schedule-job.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from './schedule.entity';
import { GoogleEventRef, uniqueGoogleEventRefs } from './google-segment-sync.util';

@Injectable()
export class ScheduleJobService {
  private readonly logger = new Logger(ScheduleJobService.name);

  constructor(
    @InjectRepository(ScheduleJob)
    private readonly jobRepo: Repository<ScheduleJob>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  /**
   * Start a task-mutation progress job (FE polls GET /schedule-jobs/:id).
   * Stages: saving → placing → syncing → done | error.
   */
  async beginMutationJob(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<ScheduleJob> {
    return this.jobRepo.save(
      this.jobRepo.create({
        userId,
        status: 'running',
        progressStage: 'saving',
        progressCurrent: null,
        progressTotal: null,
        payloadJson: JSON.stringify({ type: 'task_mutation', ...payload }),
      }),
    );
  }

  async setMutationStage(jobId: string, stage: string): Promise<void> {
    await this.jobRepo.update(
      { id: jobId },
      { progressStage: stage, status: 'running' },
    );
  }

  async completeMutationJob(
    jobId: string,
    result?: Record<string, unknown>,
  ): Promise<void> {
    await this.jobRepo.update(
      { id: jobId },
      {
        status: 'done',
        progressStage: 'done',
        resultDiffJson: result != null ? JSON.stringify(result) : null,
        errorMessage: null,
      },
    );
  }

  async failMutationJob(jobId: string, message: string): Promise<void> {
    await this.jobRepo.update(
      { id: jobId },
      {
        status: 'failed',
        progressStage: 'error',
        errorMessage: message.slice(0, 2000),
      },
    );
  }

  async getJob(jobId: string, userId: string): Promise<ScheduleJob> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }

  async getLatestDoneJob(userId: string): Promise<ScheduleJob | null> {
    return this.jobRepo.findOne({
      where: { userId, status: 'done' },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Process one pending job (oldest first). Safe to call concurrently only with DB locking in production.
   */
  async processNextPending(): Promise<boolean> {
    const pending = await this.jobRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    const job = pending[0];
    if (!job) return false;
    await this.runPendingJob(job);
    return true;
  }

  /**
   * Process this user's oldest pending replan job (so calendar sync runs right after task changes).
   */
  async processNextPendingForUser(userId: string): Promise<boolean> {
    const pending = await this.jobRepo.find({
      where: { status: 'pending', userId },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    const job = pending[0];
    if (!job) return false;
    await this.runPendingJob(job);
    return true;
  }

  /**
   * Leftover queue rows from Generate / replan are drained without writing slots.
   * New seating goes through PlacementStepService only.
   */
  private async runPendingJob(job: ScheduleJob): Promise<void> {
    job.status = 'failed';
    job.progressStage = 'failed';
    job.progressCurrent = null;
    job.progressTotal = null;
    job.errorMessage =
      'Generate, Clear, and full replan were removed. Slots are written by the placement step.';
    job.resultDiffJson = JSON.stringify({
      diff: [],
      warnings: [],
      errors: [],
      conflicts: [],
    });
    await this.jobRepo.save(job);
  }

  private fallbackCalendarId(task: Task, appCal?: string | null): string {
    return task.googleEventCalendarId ?? appCal ?? 'primary';
  }

  private refsFromScheduledRows(
    task: Task,
    rows: ScheduledTask[],
    appCal?: string | null,
  ): GoogleEventRef[] {
    return uniqueGoogleEventRefs([
      ...rows.map((r) =>
        r.googleEventId
          ? {
              eventId: r.googleEventId,
              calendarId:
                r.googleEventCalendarId ?? this.fallbackCalendarId(task, appCal),
            }
          : null,
      ),
      task.googleEventId
        ? {
            eventId: task.googleEventId,
            calendarId: this.fallbackCalendarId(task, appCal),
          }
        : null,
    ]);
  }

  private async deleteGoogleRef(
    userId: string,
    ref: GoogleEventRef,
    taskId: string,
  ): Promise<void> {
    try {
      await this.googleCalendarService.deleteEvent(
        userId,
        ref.eventId,
        ref.calendarId,
      );
    } catch (e: any) {
      this.logger.warn(
        `Google delete skipped for task ${taskId} event ${ref.eventId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Delete every Google event stored on the task or its scheduled segments.
   */
  async deleteSyncedGoogleEventsForTask(userId: string, task: Task): Promise<void> {
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    for (const ref of this.refsFromScheduledRows(task, rows)) {
      await this.deleteGoogleRef(userId, ref, task.id);
    }
  }
}
