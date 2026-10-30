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

/**
 * When a job was asked for: the app-stamped `requestedAt` (ms). DB timestamps
 * are second-precision on SQLite and zone-shifted on Postgres (H-4); rows
 * older than the stamp fall back to `createdAt`.
 */
let lastStamp = 0;
/** Strictly increasing in this process, so two requests in one ms keep their order. */
function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

function requestedAt(job: ScheduleJob): number {
  const at = parsePayload(job.payloadJson).requestedAt;
  return typeof at === 'number' ? at : new Date(job.createdAt).getTime();
}

@Injectable()
export class ScheduleJobService {
  private readonly logger = new Logger(ScheduleJobService.name);
  private readonly handlers = new Map<string, MutationHandler>();
  /** Claim lease; renewed by a heartbeat while the handler runs. Tests shorten it. */
  leaseMs = MUTATION_LEASE_MS;
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
          requestedAt: nextStamp(),
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
        leaseUntil: new Date(now.getTime() + this.leaseMs),
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
    // This worker's claim: every outcome it writes is fenced on it, so a
    // worker whose lease was taken over cannot overwrite the newer one (AUD-007).
    const fence = { attempts: job.attempts };
    const payload = parsePayload(job.payloadJson);
    if (payload.inline) {
      // Its request owned the work and never finished it (process died).
      await this.failMutationJob(jobId, 'Interrupted before it finished. Check the item and try again.', fence);
      return;
    }
    const handler = this.handlers.get(String(payload.op ?? ''));
    if (!handler) {
      await this.failMutationJob(jobId, `No handler for mutation "${String(payload.op)}"`, fence);
      return;
    }
    // A live worker keeps its lease; a dead one stops renewing and is taken over.
    const heartbeat = setInterval(() => {
      void this.jobRepo
        .update(
          { id: jobId, status: 'running', attempts: fence.attempts },
          { leaseUntil: new Date(Date.now() + this.leaseMs) },
        )
        .catch(() => undefined);
    }, Math.max(50, Math.floor(this.leaseMs / 4)));
    try {
      const result = await handler({ id: job.id, userId: job.userId, payload });
      // Some handlers finish their own job (with a result or a refusal).
      const after = await this.jobRepo.findOne({ where: { id: jobId } });
      if (after && (after.status === 'done' || after.status === 'failed')) return;
      await this.completeMutationJob(jobId, result ?? undefined, fence);
    } catch (err: unknown) {
      await this.failOrRetry(job, err);
    } finally {
      clearInterval(heartbeat);
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
      if (!refused) {
        this.logger.error(`Mutation job ${job.id} failed after ${attempts} attempts: ${message}`);
      }
      await this.failMutationJob(job.id, message, { attempts });
      return;
    }
    const delay = Math.min(MUTATION_BACKOFF_MAX_MS, MUTATION_BACKOFF_BASE_MS * 2 ** (attempts - 1));
    this.logger.warn(`Mutation job ${job.id} attempt ${attempts} failed (${message}); retry in ${delay} ms`);
    await this.jobRepo.update(
      // Only while this attempt still owns the job (AUD-007).
      { id: job.id, status: 'running', attempts },
      {
        status: 'pending',
        progressStage: 'retrying',
        nextRunAt: new Date(Date.now() + delay),
        leaseUntil: null,
        errorMessage: message.slice(0, 2000),
      },
    );
  }

  /** Newest mutation job of `op` for one task (payload holds the task id). */
  async findLatestMutationJob(
    userId: string,
    taskId: string,
    op: string,
  ): Promise<ScheduleJob | null> {
    // AUD-024: the op is matched in SQL too; taking the 10 newest jobs of the
    // task and filtering here missed a create edited more than 10 times since.
    // Payloads are JSON.stringify output, so both fragments appear exactly so.
    const rows = await this.jobRepo
      .createQueryBuilder('job')
      .where('job.userId = :userId', { userId })
      .andWhere('job.payloadJson LIKE :task', { task: `%${JSON.stringify({ taskId }).slice(1, -1)}%` })
      .andWhere('job.payloadJson LIKE :op', { op: `%${JSON.stringify({ op }).slice(1, -1)}%` })
      .orderBy('job.createdAt', 'DESC')
      .take(10)
      .getMany();
    return rows.find((row) => parsePayload(row.payloadJson).op === op) ?? null;
  }

  /**
   * AUD-018: true when a newer mutation job exists for the same task, so this
   * one's absolute intent (a drop at a clock) is stale and must not be
   * applied over the newer one. Ties on `requestedAt` go to the larger id.
   */
  async isSuperseded(jobId: string, userId: string, taskId: string): Promise<boolean> {
    const own = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!own) return false;
    const mine = requestedAt(own);
    // Payloads are JSON.stringify output: the task id appears exactly so.
    const needle = JSON.stringify({ taskId }).slice(1, -1);
    const others = await this.jobRepo
      .createQueryBuilder('job')
      .where('job.userId = :userId', { userId })
      .andWhere('job.id != :jobId', { jobId })
      .andWhere('job.payloadJson LIKE :needle', { needle: `%${needle}%` })
      .getMany();
    return others.some((other) => {
      const theirs = requestedAt(other);
      return theirs > mine || (theirs === mine && other.id > own.id);
    });
  }

  /** Record that a step committed, so a retry of this job skips it. */
  async mergeMutationPayload(
    jobId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;
    await this.jobRepo.update(
      { id: jobId },
      { payloadJson: JSON.stringify({ ...parsePayload(job.payloadJson), ...patch }) },
    );
  }

  /** Progress only; never brings a finished job back to running (AUD-007). */
  async setMutationStage(jobId: string, stage: string): Promise<void> {
    await this.jobRepo.update({ id: jobId, status: 'running' }, { progressStage: stage });
  }

  async completeMutationJob(
    jobId: string,
    result?: Record<string, unknown>,
    fence?: { attempts: number },
  ): Promise<void> {
    await this.jobRepo.update(
      fence ? { id: jobId, status: 'running', attempts: fence.attempts } : { id: jobId },
      {
        status: 'done',
        progressStage: 'done',
        resultDiffJson: result != null ? JSON.stringify(result) : null,
        errorMessage: null,
      },
    );
  }

  async failMutationJob(jobId: string, message: string, fence?: { attempts: number }): Promise<void> {
    await this.jobRepo.update(
      fence ? { id: jobId, status: 'running', attempts: fence.attempts } : { id: jobId },
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
      // AUD-012: an insert whose answer was lost may have created this event.
      task.googleInsertEventId
        ? {
            eventId: task.googleInsertEventId,
            calendarId: this.fallbackCalendarId(task, appCal),
          }
        : null,
    ]);
  }

  /** Every Google event stored on the task or its scheduled segments. */
  async googleEventRefsForTask(task: Task): Promise<GoogleEventRef[]> {
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    return this.refsFromScheduledRows(task, rows);
  }
}
