import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { ScheduleJob } from '../modules/schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../modules/google-calendar/entities/pending-google-write.entity';
import { User } from '../modules/users/user.entity';
import { ApiErrorLog } from '../modules/admin-data/entities/api-error-log.entity';
import { ClientApiService } from './client-api.service';
import { AdminStatsService } from './admin-stats.service';
import { DAY_MS, clampInt } from './admin-time';

/** A running schedule job not updated for this long is reported as stuck. */
const STUCK_JOB_MS = 10 * 60_000;

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
}

@Injectable()
export class AdminHealthService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ScheduleJob) private readonly jobs: Repository<ScheduleJob>,
    @InjectRepository(PendingGoogleWrite) private readonly writes: Repository<PendingGoogleWrite>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ApiErrorLog) private readonly apiErrors: Repository<ApiErrorLog>,
    private readonly client: ClientApiService,
    private readonly stats: AdminStatsService,
  ) {}

  async health(now = Date.now()) {
    const dbStart = Date.now();
    let dbOk = true;
    let dbError: string | null = null;
    try {
      await this.dataSource.query('SELECT 1');
    } catch (err: unknown) {
      dbOk = false;
      dbError = err instanceof Error ? err.message.slice(0, 200) : 'query failed';
    }
    const dbMs = Date.now() - dbStart;

    const [clientStatus, pendingWrites, oldestWrite, maxAttemptsRow, failed24h, stuck, running, errors] = await Promise.all([
      this.client.status(true),
      this.writes.count(),
      this.writes.findOne({ where: {}, order: { enqueuedAt: 'ASC' }, select: { id: true, enqueuedAt: true } }),
      this.writes.createQueryBuilder('w').select('MAX(w.attempts)', 'n').getRawOne<{ n: number | string | null }>(),
      this.jobs.count({ where: { status: 'failed', updatedAt: MoreThanOrEqual(new Date(now - DAY_MS)) } }),
      this.jobs.count({ where: { status: 'running', updatedAt: LessThan(new Date(now - STUCK_JOB_MS)) } }),
      this.jobs.count({ where: { status: In(['pending', 'running']) } }),
      this.stats.errorCounts(DAY_MS, now),
    ]);

    const checks = [
      { key: 'database', ok: dbOk },
      { key: 'clientApi', ok: clientStatus.ok },
      { key: 'googleQueue', ok: pendingWrites < 50 },
      { key: 'stuckJobs', ok: stuck === 0 },
      { key: 'serverErrors24h', ok: errors.server === 0 },
    ];
    const mem = process.memoryUsage();

    return {
      status: !dbOk ? 'down' : checks.every((c) => c.ok) ? 'ok' : 'degraded',
      checks,
      clientApi: clientStatus.ok
        ? { reachable: true, latencyMs: clientStatus.latencyMs, ...clientStatus.value, error: null }
        : { reachable: false, error: clientStatus.error },
      adminApi: {
        nodeEnv: process.env.NODE_ENV || 'development',
        node: process.version,
        commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
        uptimeSec: Math.round(process.uptime()),
        memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
      },
      database: { type: this.dataSource.options.type, ok: dbOk, latencyMs: dbMs, error: dbError },
      queues: {
        pendingGoogleWrites: pendingWrites,
        oldestGoogleWriteAt: iso(oldestWrite?.enqueuedAt),
        maxGoogleWriteAttempts: Number(maxAttemptsRow?.n ?? 0),
        scheduleJobsActive: running,
        scheduleJobsStuck: stuck,
        scheduleJobsFailed24h: failed24h,
      },
      errors24h: errors,
    };
  }

  async scheduleJobs(query: { status?: string; limit?: unknown }) {
    const limit = clampInt(query.limit, 1, 200, 50);
    const allowed = ['pending', 'running', 'done', 'failed'];
    const where = allowed.includes(query.status || '') ? { status: query.status as ScheduleJob['status'] } : {};
    const rows = await this.jobs.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      select: {
        id: true,
        userId: true,
        status: true,
        progressStage: true,
        progressCurrent: true,
        progressTotal: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const emails = await this.emailsFor(rows.map((r) => r.userId));
    return rows.map((r) => ({
      ...r,
      email: emails.get(r.userId) ?? null,
      durationMs: Math.max(0, new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()),
    }));
  }

  async googleWrites(limitParam: unknown) {
    const limit = clampInt(limitParam, 1, 500, 100);
    const rows = await this.writes.find({ order: { enqueuedAt: 'ASC' }, take: limit });
    const emails = await this.emailsFor(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: emails.get(r.userId) ?? null,
      taskId: r.taskId,
      operation: r.operation,
      attempts: r.attempts,
      lastError: r.lastError,
      enqueuedAt: iso(r.enqueuedAt),
    }));
  }

  /** Newest first. 401 and 404 are not stored by the client. */
  async errors(query: { minStatus?: unknown; limit?: unknown }) {
    const minStatus = clampInt(query.minStatus, 400, 599, 500);
    const limit = clampInt(query.limit, 1, 500, 200);
    const rows = await this.apiErrors.find({
      where: { status: MoreThanOrEqual(minStatus) },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return {
      retentionDays: 14,
      items: rows.map((r) => ({
        at: iso(r.createdAt),
        method: r.method,
        path: r.path,
        status: r.status,
        code: r.code,
        message: r.message,
        userId: r.userId,
      })),
    };
  }

  private async emailsFor(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const users = await this.users.find({ select: { id: true, email: true }, where: { id: In(unique) } });
    return new Map(users.map((u) => [u.id, u.email]));
  }
}
