import { HttpException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ScheduleJob } from './entities/schedule-job.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from './schedule.entity';
import { GoogleEventRef, uniqueGoogleEventRefs } from './google-segment-sync.util';

/** A running job belongs to its claimer this long; a dead process loses it after. */
export const MUTATION_LEASE_MS = 2 * 60_000;
/** Infrastructure failures are retried this many times in total, then the job fails. */
export const MUTATION_MAX_ATTEMPTS = 5;
export const MUTATION_BACKOFF_BASE_MS = 15_000;
export const MUTATION_BACKOFF_MAX_MS = 10 * 60_000;

export type MutationHandler = (job: {
  id: string;
  userId: string;
  payload: Record<string, unknown>;
}) => Promise<Record<string, unknown> | void>;

function parsePayload(json: string | null): Record<string, unknown> {
  try {
    const value = json ? JSON.parse(json) : {};
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isMutationPayload(json: string | null): boolean {
  return parsePayload(json).type === 'task_mutation';
}

@Injectable()
export class ScheduleJobService {
  private readonly logger = new Logger(ScheduleJobService.name);
  private readonly handlers = new Map<string, MutationHandler>();
  private readonly inflight = new Set<Promise<void>>();

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
   * Register the code that finishes one kind of mutation job (`payload.op`).
   * Handlers must be idempotent: a job can run again after a crash or a retry.
   * They return the job result (conflicts, parked, …) or throw.
   */
  registerHandler(op: string, handler: MutationHandler): void {
    this.handlers.set(op, handler);
  }

  /**
   * Durable intent for a mutation (FE polls GET /schedule-jobs/:id).
   * Pass the transaction `manager` that saves the state change, so the row and
   * the change commit together. `inline` marks work finished inside the
   * request itself (no handler); a crash leaves it failed, never re-run.
   * Stages: saving → placing → syncing → done | error.
   */
  async beginMutationJob(
    userId: string,
    payload: Record<string, unknown>,
    opts?: { manager?: EntityManager; inline?: boolean },
  ): Promise<ScheduleJob> {
    const repo = opts?.manager ? opts.manager.getRepository(ScheduleJob) : this.jobRepo;
    const now = new Date();
    return repo.save(
      repo.create({
        userId,
        status: opts?.inline ? 'running' : 'pending',
        progressStage: 'saving',
        progressCurrent: null,
        progressTotal: null,
        payloadJson: JSON.stringify({
          type: 'task_mutation',
          ...payload,
          ...(opts?.inline ? { inline: true } : {}),
        }),
        attempts: opts?.inline ? 1 : 0,
        nextRunAt: opts?.inline ? null : now,
        leaseUntil: opts?.inline ? new Date(now.getTime() + MUTATION_LEASE_MS) : null,
      }),
    );
  }

  /**
   * Run a just-committed job now in this process (fast path). Safe to call
   * without awaiting: the row stays the source of truth, and the recovery
   * sweep picks it up if this process dies first.
   */
  runNow(jobId: string): Promise<void> {
    const run = (async () => {
      if (await this.claim(jobId)) await this.execute(jobId);
    })().catch((err: unknown) => {
      this.logger.error(`Mutation job ${jobId} crashed: ${err}`);
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
    return run;
  }

  /** Wait for every job this process is running (tests, graceful shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size) {
      await Promise.all([...this.inflight]);
    }
  }

  /**
   * Recovery sweep: run due `pending` rows (new or retry) and take over
   * `running` rows whose lease expired (their process died). Legacy
   * Generate/replan rows are failed as before.
   */
  async processDue(limit = 10): Promise<number> {
    const now = new Date();
    const candidates = await this.jobRepo
      .createQueryBuilder('job')
      .where(
        '(job.status = :pending AND (job.nextRunAt IS NULL OR job.nextRunAt <= :now))' +
          ' OR (job.status = :running AND job.leaseUntil IS NOT NULL AND job.leaseUntil < :now)',
        { pending: 'pending', running: 'running', now },
      )
      .orderBy('job.createdAt', 'ASC')
      .take(limit)
      .getMany();
    let ran = 0;
    for (const job of candidates) {
      if (!isMutationPayload(job.payloadJson)) {
        await this.runPendingJob(job);
        continue;
      }
      if (await this.claim(job.id)) {
        await this.execute(job.id);
        ran += 1;
      }
    }
    return ran;
  }

  /**
   * Take a job for this process: one conditional UPDATE, so two workers (or a
   * fast path and the sweep) never run the same attempt.
   */
  private async claim(jobId: string): Promise<boolean> {
    const now = new Date();
    const qb = this.jobRepo.createQueryBuilder().update(ScheduleJob);
    // Raw column names must be quoted: Postgres folds unquoted names to lower case.
    const col = (name: string) => qb.escape(name);
    const result = await qb
      .set({
        status: 'running',
        leaseUntil: new Date(now.getTime() + MUTATION_LEASE_MS),
        attempts: () => `${col('attempts')} + 1`,
      })
      .where(`${col('id')} = :id`, { id: jobId })
      .andWhere(
        `((${col('status')} = :pending AND (${col('nextRunAt')} IS NULL OR ${col('nextRunAt')} <= :now))` +
          ` OR (${col('status')} = :running AND ${col('leaseUntil')} IS NOT NULL AND ${col('leaseUntil')} < :now))`,
        { pending: 'pending', running: 'running', now },
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }


  private async execute(jobId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;
    const payload = parsePayload(job.payloadJson);
    if (payload.inline) {
      // Its request owned the work and never finished it (process died).
      await this.failMutationJob(jobId, 'Interrupted before it finished. Check the item and try again.');
      return;
    }
    const handler = this.handlers.get(String(payload.op ?? ''));
    if (!handler) {
      await this.failMutationJob(jobId, `No handler for mutation "${String(payload.op)}"`);
      return;
    }
    try {
      const result = await handler({ id: job.id, userId: job.userId, payload });
      // Some handlers finish their own job (with a result or a refusal).
      const after = await this.jobRepo.findOne({ where: { id: jobId } });
      if (after && (after.status === 'done' || after.status === 'failed')) return;
      await this.completeMutationJob(jobId, result ?? undefined);
    } catch (err: unknown) {
      await this.failOrRetry(job, err);
    }
  }

  /**
   * A refused request (4xx) is a final answer. Anything else is treated as an
   * infrastructure failure: retry with backoff, then fail visibly.
   */
  private async failOrRetry(job: ScheduleJob, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const refused = err instanceof HttpException && err.getStatus() < 500;
    const attempts = job.attempts ?? 1;
    if (refused || attempts >= MUTATION_MAX_ATTEMPTS) {
      await this.failMutationJob(job.id, message);
      return;
    }
    const delay = Math.min(MUTATION_BACKOFF_MAX_MS, MUTATION_BACKOFF_BASE_MS * 2 ** (attempts - 1));
    this.logger.warn(`Mutation job ${job.id} attempt ${attempts} failed (${message}); retry in ${delay} ms`);
    await this.jobRepo.update(
      { id: job.id },
      {
        status: 'pending',
        progressStage: 'retrying',
        nextRunAt: new Date(Date.now() + delay),
        leaseUntil: null,
        errorMessage: message.slice(0, 2000),
      },
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
