import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduleJob } from './entities/schedule-job.entity';
import { ScheduleUndoSnapshot } from './entities/schedule-undo-snapshot.entity';
import { IntelligentSchedulingEngine } from './intelligent-scheduling.engine';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task } from '../tasks/entities/task.entity';

@Injectable()
export class ScheduleJobService {
  private readonly logger = new Logger(ScheduleJobService.name);

  constructor(
    @InjectRepository(ScheduleJob)
    private readonly jobRepo: Repository<ScheduleJob>,
    @InjectRepository(ScheduleUndoSnapshot)
    private readonly snapshotRepo: Repository<ScheduleUndoSnapshot>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly engine: IntelligentSchedulingEngine,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  async enqueueReplan(userId: string): Promise<ScheduleJob> {
    const job = this.jobRepo.create({
      userId,
      status: 'pending',
      payloadJson: JSON.stringify({ type: 'full_replan', at: new Date().toISOString() }),
    });
    return this.jobRepo.save(job);
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

    job.status = 'running';
    await this.jobRepo.save(job);

    try {
      const snapshotRows = await this.engine.captureAutoSegmentsSnapshot(
        job.userId,
      );
      const snap = this.snapshotRepo.create({
        userId: job.userId,
        jobId: job.id,
        payloadJson: JSON.stringify({ segments: snapshotRows }),
      });
      const savedSnap = await this.snapshotRepo.save(snap);

      const result = await this.engine.run(job.userId);

      job.status = 'done';
      job.resultDiffJson = JSON.stringify({
        diff: result.diff,
        warnings: result.warnings,
        errors: result.errors,
      });
      job.errorMessage = null;
      job.undoSnapshotId = savedSnap.id;
      await this.jobRepo.save(job);
    } catch (e: any) {
      job.status = 'failed';
      job.errorMessage = e?.message ?? String(e);
      await this.jobRepo.save(job);
    }

    return true;
  }

  async undoLast(userId: string): Promise<{ restored: boolean }> {
    const job = await this.jobRepo.findOne({
      where: { userId, status: 'done' },
      order: { updatedAt: 'DESC' },
    });
    if (!job?.undoSnapshotId) {
      throw new BadRequestException('Nothing to undo');
    }

    const snap = await this.snapshotRepo.findOne({
      where: { id: job.undoSnapshotId },
    });
    if (!snap || snap.userId !== userId) {
      throw new NotFoundException('Snapshot not found');
    }

    const data = JSON.parse(snap.payloadJson) as {
      segments: {
        id: string;
        taskId: string;
        scheduledStartTime: string;
        scheduledEndTime: string;
      }[];
    };

    await this.engine.restoreSnapshot(userId, data.segments ?? []);

    job.undoSnapshotId = null;
    await this.jobRepo.save(job);

    await this.syncGoogleAfterUndo(userId, data.segments ?? []);

    return { restored: true };
  }

  /**
   * One Google event per task (`googleEventId`): span = min/max of restored auto segments.
   */
  private async syncGoogleAfterUndo(
    userId: string,
    segments: {
      taskId: string;
      scheduledStartTime: string;
      scheduledEndTime: string;
    }[],
  ): Promise<void> {
    if (!segments.length) return;

    const byTask = new Map<
      string,
      { minStart: number; maxEnd: number }
    >();
    for (const s of segments) {
      const a = new Date(s.scheduledStartTime).getTime();
      const b = new Date(s.scheduledEndTime).getTime();
      const cur = byTask.get(s.taskId);
      if (!cur) {
        byTask.set(s.taskId, { minStart: a, maxEnd: b });
      } else {
        cur.minStart = Math.min(cur.minStart, a);
        cur.maxEnd = Math.max(cur.maxEnd, b);
      }
    }

    for (const [taskId, range] of byTask) {
      const task = await this.taskRepo.findOne({
        where: { id: taskId, userId },
        select: ['id', 'googleEventId'],
      });
      if (!task?.googleEventId) continue;

      try {
        await this.googleCalendarService.patchEventDateTime(
          userId,
          task.googleEventId,
          new Date(range.minStart),
          new Date(range.maxEnd),
        );
      } catch (e: any) {
        this.logger.warn(
          `Google Calendar undo sync skipped for task ${taskId}: ${e?.message ?? e}`,
        );
      }
    }
  }
}
