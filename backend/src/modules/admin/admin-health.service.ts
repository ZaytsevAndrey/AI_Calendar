import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { ScheduleJob } from '../schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../google-calendar/entities/pending-google-write.entity';
import { User } from '../users/user.entity';
import { countAdminErrors } from '../../common/admin-error-log';
import { DAY_MS, clampInt } from './admin-time';

export type IntegrationStatus = {
  key: string;
  label: string;
  group: 'auth' | 'llm' | 'speech' | 'push' | 'other';
  configured: boolean;
  detail?: string;
};

/** Present and non-empty. Values are never returned, only whether they are set. */
function has(env: NodeJS.ProcessEnv, ...keys: string[]): boolean {
  return keys.every((k) => Boolean((env[k] || '').trim()));
}

export function integrationStatus(env: NodeJS.ProcessEnv = process.env): IntegrationStatus[] {
  const voiceProvider = (env.VOICE_LLM_PROVIDER || '').trim() || 'default';
  return [
    { key: 'google', label: 'Google OAuth / Calendar', group: 'auth', configured: has(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET') },
    { key: 'microsoft', label: 'Microsoft OAuth / Outlook', group: 'auth', configured: has(env, 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET') },
    { key: 'admin', label: 'Admin emails', group: 'auth', configured: has(env, 'ADMIN_EMAILS') },
    { key: 'groq', label: 'Groq (LLM + Whisper STT)', group: 'llm', configured: has(env, 'GROQ_API_KEY'), detail: env.GROQ_PLANNER_MODEL || env.GROQ_LLM_MODEL || undefined },
    { key: 'gemini', label: 'Gemini planner', group: 'llm', configured: has(env, 'GEMINI_API_KEY'), detail: env.GEMINI_PLANNER_MODEL || undefined },
    { key: 'deepseek', label: 'DeepSeek planner', group: 'llm', configured: has(env, 'DEEPSEEK_API_KEY'), detail: env.DEEPSEEK_PLANNER_MODEL || undefined },
    { key: 'qwen', label: 'Qwen planner', group: 'llm', configured: has(env, 'QWEN_API_KEY'), detail: env.QWEN_PLANNER_MODEL || undefined },
    { key: 'openai', label: 'OpenAI', group: 'llm', configured: has(env, 'OPENAI_API_KEY') },
    { key: 'local-llm', label: 'Local LLM (LLM_BASE_URL)', group: 'llm', configured: has(env, 'LLM_BASE_URL'), detail: env.LLM_MODEL || undefined },
    { key: 'voice-provider', label: 'Voice LLM provider', group: 'llm', configured: true, detail: voiceProvider },
    { key: 'azure-speech', label: 'Azure Speech (STT/TTS)', group: 'speech', configured: has(env, 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'), detail: env.AZURE_SPEECH_REGION || undefined },
    { key: 'piper', label: 'Piper TTS', group: 'speech', configured: has(env, 'PIPER_URL') },
    { key: 'vapid', label: 'Web Push (VAPID)', group: 'push', configured: has(env, 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY') },
    { key: 'reminder-cron', label: 'Reminder cron secret', group: 'push', configured: has(env, 'REMINDER_CRON_SECRET') },
    { key: 'photon', label: 'Places search (Photon)', group: 'other', configured: has(env, 'PHOTON_URL') },
  ];
}

/** A running schedule job not updated for this long is reported as stuck. */
const STUCK_JOB_MS = 10 * 60_000;

@Injectable()
export class AdminHealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ScheduleJob) private readonly jobs: Repository<ScheduleJob>,
    @InjectRepository(PendingGoogleWrite) private readonly writes: Repository<PendingGoogleWrite>,
    @InjectRepository(User) private readonly users: Repository<User>,
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

    const [pendingWrites, oldestWrite, maxAttemptsRow, failed24h, stuck, running] = await Promise.all([
      this.writes.count(),
      this.writes.findOne({ where: {}, order: { enqueuedAt: 'ASC' }, select: { id: true, enqueuedAt: true } }),
      this.writes
        .createQueryBuilder('w')
        .select('MAX(w.attempts)', 'n')
        .getRawOne<{ n: number | string | null }>(),
      this.jobs.count({ where: { status: 'failed', updatedAt: MoreThanOrEqual(new Date(now - DAY_MS)) } }),
      this.jobs.count({ where: { status: 'running', updatedAt: LessThan(new Date(now - STUCK_JOB_MS)) } }),
      this.jobs.count({ where: { status: In(['pending', 'running']) } }),
    ]);

    const mem = process.memoryUsage();
    const errors = countAdminErrors(DAY_MS, now);
    const integrations = integrationStatus();
    const checks = [
      { key: 'database', ok: dbOk, detail: dbOk ? `${dbMs} ms` : dbError },
      { key: 'googleQueue', ok: pendingWrites < 50, detail: `${pendingWrites} pending` },
      { key: 'stuckJobs', ok: stuck === 0, detail: `${stuck} stuck` },
      { key: 'serverErrors24h', ok: errors.server === 0, detail: `${errors.server} × 5xx` },
    ];

    return {
      status: checks.every((c) => c.ok) ? 'ok' : dbOk ? 'degraded' : 'down',
      checks,
      app: {
        nodeEnv: process.env.NODE_ENV || 'development',
        node: process.version,
        commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
        startedAt: new Date(this.startedAt).toISOString(),
        uptimeSec: Math.round(process.uptime()),
        memoryMb: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576),
        },
      },
      database: {
        type: this.dataSource.options.type,
        ok: dbOk,
        latencyMs: dbMs,
        error: dbError,
        typeormSync: process.env.TYPEORM_SYNC !== 'false',
      },
      queues: {
        pendingGoogleWrites: pendingWrites,
        oldestGoogleWriteAt: oldestWrite?.enqueuedAt ? new Date(oldestWrite.enqueuedAt).toISOString() : null,
        maxGoogleWriteAttempts: Number(maxAttemptsRow?.n ?? 0),
        scheduleJobsActive: running,
        scheduleJobsStuck: stuck,
        scheduleJobsFailed24h: failed24h,
      },
      errors24h: errors,
      integrations,
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
      enqueuedAt: r.enqueuedAt,
    }));
  }

  private async emailsFor(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const users = await this.users.find({ select: { id: true, email: true }, where: { id: In(unique) } });
    return new Map(users.map((u) => [u.id, u.email]));
  }
}
