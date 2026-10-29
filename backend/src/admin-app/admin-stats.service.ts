import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '../modules/users/user.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { VoiceDailyUsage } from '../modules/voice/entities/voice-daily-usage.entity';
import { UserIdentity } from '../modules/auth/entities/user-identity.entity';
import { UserSettings } from '../modules/user-settings/entities/user-settings.entity';
import { ScheduleJob } from '../modules/schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../modules/google-calendar/entities/pending-google-write.entity';
import { PushSubscription } from '../modules/reminders/entities/push-subscription.entity';
import { ReminderDelivery } from '../modules/reminders/entities/reminder-delivery.entity';
import { VoiceTurnLog } from '../modules/admin-data/entities/voice-turn-log.entity';
import { ApiErrorLog } from '../modules/admin-data/entities/api-error-log.entity';
import { localYmd } from '../modules/voice/voice-local-date.util';
import { resolveIanaTimeZone } from '../common/iana-time-zone';
import { ClientApiService } from './client-api.service';
import { DAY_MS, clampInt, lastUtcDays, percentile, utcYmd } from './admin-time';

export type AdminUserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastActiveAt: string | null;
  isBlocked: boolean;
  providers: string[];
  tasks: number;
  voiceTokens7d: number;
  timeZone: string | null;
  language: string | null;
};

type VoiceStepLike = {
  kind?: string;
  name?: string;
  via?: string;
  ms?: number;
  ok?: boolean;
  valid?: boolean;
  errorCode?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseSteps(json: string): VoiceStepLike[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

@Injectable()
export class AdminStatsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(VoiceDailyUsage) private readonly usage: Repository<VoiceDailyUsage>,
    @InjectRepository(VoiceTurnLog) private readonly turns: Repository<VoiceTurnLog>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(UserSettings) private readonly settings: Repository<UserSettings>,
    @InjectRepository(ScheduleJob) private readonly jobs: Repository<ScheduleJob>,
    @InjectRepository(PendingGoogleWrite) private readonly writes: Repository<PendingGoogleWrite>,
    @InjectRepository(PushSubscription) private readonly pushSubs: Repository<PushSubscription>,
    @InjectRepository(ReminderDelivery) private readonly deliveries: Repository<ReminderDelivery>,
    @InjectRepository(ApiErrorLog) private readonly apiErrors: Repository<ApiErrorLog>,
    private readonly client: ClientApiService,
  ) {}

  // ---------------------------------------------------------------- overview

  /** Server (5xx) and client (4xx, minus 401/404 which are not stored) errors in a window. */
  async errorCounts(windowMs: number, now = Date.now()): Promise<{ server: number; client: number }> {
    const since = new Date(now - windowMs);
    const [server, all] = await Promise.all([
      this.apiErrors.count({ where: { status: MoreThanOrEqual(500), createdAt: MoreThanOrEqual(since) } }),
      this.apiErrors.count({ where: { createdAt: MoreThanOrEqual(since) } }),
    ]);
    return { server, client: all - server };
  }

  async overview(now = Date.now()) {
    const dailyTokenLimit = await this.client.voiceDailyLimit();
    const errors24h = await this.errorCounts(DAY_MS, now);
    const since = (ms: number) => new Date(now - ms);
    const days = lastUtcDays(30, now);
    const firstDay = days[0];

    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      active24h,
      active7d,
      blocked,
      totalTasks,
      tasks7d,
      pendingWrites,
      failedJobs24h,
      pushSubscribers,
      remindersSent24h,
    ] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { createdAt: MoreThanOrEqual(since(7 * DAY_MS)) } }),
      this.users.count({ where: { createdAt: MoreThanOrEqual(since(30 * DAY_MS)) } }),
      this.users.count({ where: { lastActiveAt: MoreThanOrEqual(since(DAY_MS)) } }),
      this.users.count({ where: { lastActiveAt: MoreThanOrEqual(since(7 * DAY_MS)) } }),
      this.users.count({ where: { isBlocked: true } }),
      this.tasks.count(),
      this.tasks.count({ where: { createdAt: MoreThanOrEqual(since(7 * DAY_MS)) } }),
      this.writes.count(),
      this.jobs.count({
        where: { status: 'failed', updatedAt: MoreThanOrEqual(since(DAY_MS)) },
      }),
      this.pushSubs
        .createQueryBuilder('p')
        .select('COUNT(DISTINCT p.userId)', 'n')
        .getRawOne<{ n: string | number }>()
        .then((r) => Number(r?.n ?? 0)),
      this.deliveries.count({ where: { sentAt: MoreThanOrEqual(since(DAY_MS)) } }),
    ]);

    const [signupRows, usageRows, turnRows, statusRows] = await Promise.all([
      this.users.find({
        select: { id: true, createdAt: true },
        where: { createdAt: MoreThanOrEqual(new Date(`${firstDay}T00:00:00Z`)) },
      }),
      this.usage.find({ where: { dayYmd: MoreThanOrEqual(firstDay) } }),
      this.turns.find({
        select: { id: true, createdAt: true, statusCode: true, totalMs: true, userId: true },
        where: { createdAt: MoreThanOrEqual(new Date(`${firstDay}T00:00:00Z`)) },
      }),
      this.tasks
        .createQueryBuilder('t')
        .select('t.status', 'status')
        .addSelect('COUNT(*)', 'n')
        .groupBy('t.status')
        .getRawMany<{ status: string; n: string | number }>(),
    ]);

    const series = days.map((day) => ({
      day,
      signups: 0,
      voiceTokens: 0,
      voiceUsers: 0,
      voiceTurns: 0,
      voiceErrors: 0,
    }));
    const byDay = new Map(series.map((row) => [row.day, row]));
    for (const u of signupRows) {
      const row = byDay.get(utcYmd(u.createdAt));
      if (row) row.signups += 1;
    }
    for (const u of usageRows) {
      const row = byDay.get(u.dayYmd);
      if (!row) continue;
      row.voiceTokens += u.tokensUsed;
      if (u.tokensUsed > 0) row.voiceUsers += 1;
    }
    for (const t of turnRows) {
      const row = byDay.get(utcYmd(t.createdAt));
      if (!row) continue;
      row.voiceTurns += 1;
      if (t.statusCode >= 400) row.voiceErrors += 1;
    }

    const recentTurns = turnRows.filter((t) => now - new Date(t.createdAt).getTime() <= DAY_MS);
    const today = utcYmd(now);
    const last7 = new Set(days.slice(-7));
    const voiceUsers7d = new Set(
      usageRows.filter((u) => last7.has(u.dayYmd) && u.tokensUsed > 0).map((u) => u.userId),
    ).size;

    return {
      generatedAt: new Date(now).toISOString(),
      users: { total: totalUsers, new7d: newUsers7d, new30d: newUsers30d, active24h, active7d, blocked },
      tasks: {
        total: totalTasks,
        created7d: tasks7d,
        byStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])),
      },
      voice: {
        dailyTokenLimit,
        tokensToday: usageRows.filter((u) => u.dayYmd === today).reduce((t, u) => t + u.tokensUsed, 0),
        tokens7d: usageRows.filter((u) => last7.has(u.dayYmd)).reduce((t, u) => t + u.tokensUsed, 0),
        users7d: voiceUsers7d,
        turns24h: recentTurns.length,
        errorRate24h: recentTurns.length
          ? recentTurns.filter((t) => t.statusCode >= 400).length / recentTurns.length
          : 0,
        p50Ms24h: percentile(recentTurns.map((t) => t.totalMs), 50),
        p95Ms24h: percentile(recentTurns.map((t) => t.totalMs), 95),
      },
      ops: {
        pendingGoogleWrites: pendingWrites,
        failedScheduleJobs24h: failedJobs24h,
        errors24h,
        pushSubscribers,
        remindersSent24h,
      },
      series,
    };
  }

  // ------------------------------------------------------------------- users

  async listUsers(query: { search?: string; page?: unknown; pageSize?: unknown; sort?: string }, now = Date.now()) {
    const page = clampInt(query.page, 1, 10_000, 1);
    const pageSize = clampInt(query.pageSize, 5, 200, 50);
    const qb = this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.createdAt', 'u.lastActiveAt', 'u.isBlocked', 'u.googleId']);
    const search = (query.search || '').trim().toLowerCase().slice(0, 200);
    if (search) {
      // `%` and `_` in the search are literal, not wildcards.
      const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`);
      qb.where(
        new Brackets((w) => {
          w.where("LOWER(u.email) LIKE :q ESCAPE '\\'", { q: `%${escaped}%` });
          if (UUID_RE.test(search)) w.orWhere('u.id = :id', { id: search });
        }),
      );
    }
    if (query.sort === 'active') {
      qb.orderBy('u.lastActiveAt', 'DESC', 'NULLS LAST');
    } else if (query.sort === 'email') {
      qb.orderBy('u.email', 'ASC');
    } else {
      qb.orderBy('u.createdAt', 'DESC');
    }
    const [rows, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const items = await this.decorateUsers(rows, now);
    return { page, pageSize, total, items };
  }

  private async decorateUsers(rows: User[], now: number): Promise<AdminUserRow[]> {
    const ids = rows.map((u) => u.id);
    if (!ids.length) return [];
    const weekAgo = utcYmd(now - 6 * DAY_MS);
    const [taskCounts, usageRows, identityRows, settingsRows] = await Promise.all([
      this.tasks
        .createQueryBuilder('t')
        .select('t.userId', 'userId')
        .addSelect('COUNT(*)', 'n')
        .where('t.userId IN (:...ids)', { ids })
        .groupBy('t.userId')
        .getRawMany<{ userId: string; n: string | number }>(),
      this.usage.find({ where: { userId: In(ids), dayYmd: MoreThanOrEqual(weekAgo) } }),
      this.identities.find({ select: { userId: true, provider: true }, where: { userId: In(ids) } }),
      this.settings.find({
        select: { id: true, userId: true, timeZone: true, language: true },
        where: { userId: In(ids) },
      }),
    ]);
    const tasksBy = new Map(taskCounts.map((r) => [r.userId, Number(r.n)]));
    const tokensBy = new Map<string, number>();
    for (const u of usageRows) tokensBy.set(u.userId, (tokensBy.get(u.userId) ?? 0) + u.tokensUsed);
    const providersBy = new Map<string, Set<string>>();
    for (const i of identityRows) {
      const set = providersBy.get(i.userId) ?? new Set<string>();
      set.add(i.provider);
      providersBy.set(i.userId, set);
    }
    const settingsBy = new Map(settingsRows.map((s) => [s.userId, s]));
    return rows.map((u) => {
      const providers = providersBy.get(u.id) ?? new Set<string>();
      if (u.googleId) providers.add('google');
      const s = settingsBy.get(u.id);
      return {
        id: u.id,
        email: u.email,
        createdAt: iso(u.createdAt) as string,
        lastActiveAt: iso(u.lastActiveAt),
        isBlocked: u.isBlocked === true,
        providers: [...providers].sort(),
        tasks: tasksBy.get(u.id) ?? 0,
        voiceTokens7d: tokensBy.get(u.id) ?? 0,
        timeZone: s?.timeZone ?? null,
        language: s?.language ?? null,
      };
    });
  }

  async userDetail(userId: string, now = Date.now()) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        lastActiveAt: true,
        isBlocked: true,
        googleId: true,
        isEmailVerified: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const days = lastUtcDays(30, now);
    const [row] = await this.decorateUsers([user], now);
    const [identities, settings, statusRows, scheduled, usageRows, turns, jobs, writes, pushCount, reminders7d] =
      await Promise.all([
        this.identities.find({
          select: { id: true, provider: true, email: true, createdAt: true, isRegistrationIdentity: true },
          where: { userId },
        }),
        this.settings.findOne({ where: { userId } }),
        this.tasks
          .createQueryBuilder('t')
          .select('t.status', 'status')
          .addSelect('COUNT(*)', 'n')
          .where('t.userId = :userId', { userId })
          .groupBy('t.status')
          .getRawMany<{ status: string; n: string | number }>(),
        this.tasks
          .createQueryBuilder('t')
          .where('t.userId = :userId', { userId })
          .andWhere('t.scheduledStartTime IS NOT NULL')
          .getCount(),
        this.usage.find({ where: { userId, dayYmd: MoreThanOrEqual(days[0]) } }),
        this.turns.find({
          where: { userId },
          order: { createdAt: 'DESC' },
          take: 20,
          select: {
            id: true,
            createdAt: true,
            path: true,
            statusCode: true,
            totalMs: true,
            llmCalls: true,
            tokens: true,
            errorCode: true,
          },
        }),
        this.jobs.find({
          where: { userId },
          order: { createdAt: 'DESC' },
          take: 10,
          select: { id: true, status: true, progressStage: true, errorMessage: true, createdAt: true, updatedAt: true },
        }),
        this.writes.find({ where: { userId }, order: { enqueuedAt: 'ASC' }, take: 20 }),
        this.pushSubs.count({ where: { userId } }),
        this.deliveries.count({ where: { userId, sentAt: MoreThanOrEqual(new Date(now - 7 * DAY_MS)) } }),
      ]);
    const usageBy = new Map(usageRows.map((u) => [u.dayYmd, u.tokensUsed]));
    // Same civil day the client uses for the daily limit: the user's settings zone.
    const todayLocal = localYmd(new Date(now).toISOString(), resolveIanaTimeZone(settings?.timeZone || 'UTC'));
    const tokensToday = usageRows.find((u) => u.dayYmd === todayLocal)?.tokensUsed ?? 0;
    const dailyTokenLimit = await this.client.voiceDailyLimit();
    return {
      user: {
        ...row,
        updatedAt: iso(user.updatedAt),
        isEmailVerified: user.isEmailVerified,
        hasGoogleLogin: Boolean(user.googleId),
      },
      settings: settings
        ? {
            timeZone: settings.timeZone ?? null,
            language: settings.language ?? null,
            speechLanguage: settings.speechLanguage ?? null,
          }
        : null,
      identities: identities.map((i) => ({
        provider: i.provider,
        email: i.email,
        createdAt: iso(i.createdAt),
        isRegistrationIdentity: i.isRegistrationIdentity,
      })),
      tasks: {
        byStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])),
        scheduled,
      },
      voice: {
        dailyTokenLimit,
        tokensToday,
        series: days.map((day) => ({ day, tokens: usageBy.get(day) ?? 0 })),
        recentTurns: turns.map((t) => ({ ...t, createdAt: iso(t.createdAt) })),
      },
      jobs: jobs.map((j) => ({ ...j, createdAt: iso(j.createdAt), updatedAt: iso(j.updatedAt) })),
      pendingGoogleWrites: writes.map((w) => ({
        id: w.id,
        operation: w.operation,
        attempts: w.attempts,
        lastError: w.lastError,
        enqueuedAt: iso(w.enqueuedAt),
      })),
      push: { subscriptions: pushCount, remindersSent7d: reminders7d },
    };
  }

  // ------------------------------------------------------------------- voice

  async voiceSummary(daysParam: unknown, now = Date.now()) {
    const daysCount = clampInt(daysParam, 1, 90, 30);
    const days = lastUtcDays(daysCount, now);
    const from = new Date(`${days[0]}T00:00:00Z`);
    const [usageRows, turnRows] = await Promise.all([
      this.usage.find({ where: { dayYmd: MoreThanOrEqual(days[0]) } }),
      this.turns.find({ where: { createdAt: MoreThanOrEqual(from) } }),
    ]);

    const tokensByUser = new Map<string, number>();
    for (const u of usageRows) tokensByUser.set(u.userId, (tokensByUser.get(u.userId) ?? 0) + u.tokensUsed);
    const topIds = [...tokensByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const emails = topIds.length
      ? await this.users.find({ select: { id: true, email: true }, where: { id: In(topIds.map(([id]) => id)) } })
      : [];
    const emailBy = new Map(emails.map((u) => [u.id, u.email]));
    const turnsByUser = new Map<string, number>();
    for (const t of turnRows) if (t.userId) turnsByUser.set(t.userId, (turnsByUser.get(t.userId) ?? 0) + 1);

    const models = new Map<string, { calls: number; failed: number; ms: number[]; tokens: number }>();
    const codes = new Map<string, number>();
    const routes = new Map<string, { turns: number; errors: number; ms: number[] }>();
    for (const t of turnRows) {
      const route = routes.get(t.path) ?? { turns: 0, errors: 0, ms: [] };
      route.turns += 1;
      if (t.statusCode >= 400) route.errors += 1;
      route.ms.push(t.totalMs);
      routes.set(t.path, route);
      if (t.errorCode) codes.set(t.errorCode, (codes.get(t.errorCode) ?? 0) + 1);
      for (const step of parseSteps(t.stepsJson)) {
        if (step.kind !== 'llm') continue;
        const key = step.via || step.name || 'unknown';
        const m = models.get(key) ?? { calls: 0, failed: 0, ms: [], tokens: 0 };
        m.calls += 1;
        if (step.ok === false) m.failed += 1;
        m.ms.push(step.ms ?? 0);
        m.tokens += Number((step as { tokens?: number }).tokens ?? 0);
        models.set(key, m);
      }
    }

    const series = days.map((day) => ({ day, tokens: 0, users: 0, turns: 0, errors: 0 }));
    const byDay = new Map(series.map((r) => [r.day, r]));
    for (const u of usageRows) {
      const r = byDay.get(u.dayYmd);
      if (!r) continue;
      r.tokens += u.tokensUsed;
      if (u.tokensUsed > 0) r.users += 1;
    }
    for (const t of turnRows) {
      const r = byDay.get(utcYmd(t.createdAt));
      if (!r) continue;
      r.turns += 1;
      if (t.statusCode >= 400) r.errors += 1;
    }

    return {
      days: daysCount,
      dailyTokenLimit: await this.client.voiceDailyLimit(),
      totals: {
        tokens: usageRows.reduce((t, u) => t + u.tokensUsed, 0),
        turns: turnRows.length,
        errors: turnRows.filter((t) => t.statusCode >= 400).length,
        users: tokensByUser.size,
        p50Ms: percentile(turnRows.map((t) => t.totalMs), 50),
        p95Ms: percentile(turnRows.map((t) => t.totalMs), 95),
      },
      series,
      topUsers: topIds.map(([id, tokens]) => ({
        userId: id,
        email: emailBy.get(id) ?? null,
        tokens,
        turns: turnsByUser.get(id) ?? 0,
      })),
      models: [...models.entries()]
        .map(([via, m]) => ({
          via,
          calls: m.calls,
          failed: m.failed,
          tokens: m.tokens,
          p50Ms: percentile(m.ms, 50),
          p95Ms: percentile(m.ms, 95),
        }))
        .sort((a, b) => b.calls - a.calls),
      routes: [...routes.entries()]
        .map(([path, r]) => ({
          path,
          turns: r.turns,
          errors: r.errors,
          p50Ms: percentile(r.ms, 50),
          p95Ms: percentile(r.ms, 95),
        }))
        .sort((a, b) => b.turns - a.turns),
      errorCodes: [...codes.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
    };
  }

  async voiceTurns(query: { userId?: string; failed?: string; before?: string; limit?: unknown }) {
    const limit = clampInt(query.limit, 1, 200, 50);
    const qb = this.turns
      .createQueryBuilder('t')
      .select([
        't.id',
        't.userId',
        't.traceId',
        't.method',
        't.path',
        't.statusCode',
        't.totalMs',
        't.llmCalls',
        't.llmMs',
        't.tokens',
        't.failedSteps',
        't.errorCode',
        't.createdAt',
      ])
      .orderBy('t.createdAt', 'DESC')
      .take(limit + 1);
    if (query.userId) {
      // Postgres refuses a non-uuid against a uuid column with a 500.
      if (!UUID_RE.test(query.userId)) return { items: [], nextBefore: null };
      qb.andWhere('t.userId = :userId', { userId: query.userId });
    }
    if (query.failed === '1' || query.failed === 'true') {
      qb.andWhere(new Brackets((w) => w.where('t.statusCode >= 400').orWhere('t.failedSteps > 0')));
    }
    if (query.before) {
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) qb.andWhere('t.createdAt < :before', { before });
    }
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const userIds = [...new Set(page.map((t) => t.userId).filter((id): id is string => Boolean(id)))];
    const users = userIds.length
      ? await this.users.find({ select: { id: true, email: true }, where: { id: In(userIds) } })
      : [];
    const emailBy = new Map(users.map((u) => [u.id, u.email]));
    return {
      items: page.map((t) => ({
        ...t,
        createdAt: iso(t.createdAt),
        email: t.userId ? emailBy.get(t.userId) ?? null : null,
      })),
      nextBefore: rows.length > limit ? iso(page[page.length - 1].createdAt) : null,
    };
  }

  async voiceTurn(id: string) {
    const turn = await this.turns.findOne({ where: { id } });
    if (!turn) throw new NotFoundException('Turn not found');
    const user = turn.userId
      ? await this.users.findOne({ select: { id: true, email: true }, where: { id: turn.userId } })
      : null;
    const { stepsJson, ...rest } = turn;
    return {
      ...rest,
      createdAt: iso(turn.createdAt),
      email: user?.email ?? null,
      steps: parseSteps(stepsJson),
    };
  }
}
