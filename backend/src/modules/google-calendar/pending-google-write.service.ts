import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, MoreThan, Not, Repository } from 'typeorm';
import { recordGoogleWrite, setGoogleOutboxKick } from './google-sync-outbox';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { phaseHexToGoogleColorId } from './phase-hex-to-google-color-id.util';
import { applyTaskGoogleEventFields } from './task-google-event-fields.util';
import { GoogleCalendarService, isGoogleEventMissing } from './google-calendar.service';
import {
  PendingGoogleWrite,
  type PendingGoogleWriteOperation,
} from './entities/pending-google-write.entity';
import {
  googleContentDiffers,
  googleEditedAfterEnqueue,
  googleEventFieldsFromApi,
} from './pending-google-write.util';
import { isProblematicSchedule, Task } from '../tasks/entities/task.entity';
import { excludeStartsForSkippedYmds } from '../tasks/skipped-occurrence.util';
import { buildGoogleRecurrenceRules } from '../schedule/google-recurrence.util';
import { effectiveRecurrenceWeekDays } from '../schedule/recurrence-from-phases.util';
import { pickMajorityClockSlot } from '../schedule/series-group.util';
import { ScheduledTask } from '../schedule/schedule.entity';
import { localHm, localYmd } from '../voice/voice-local-date.util';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

export const GOOGLE_WRITE_LEASE_MS = 2 * 60_000;
export const GOOGLE_WRITE_MAX_ATTEMPTS = 8;
export const GOOGLE_WRITE_BACKOFF_BASE_MS = 60_000;
export const GOOGLE_WRITE_BACKOFF_MAX_MS = 60 * 60_000;
export const GOOGLE_WRITE_PER_USER = 5;
/** How long a connection check is trusted (a down one longer: no refresh storm). */
export const GOOGLE_CONNECTION_OK_TTL_MS = 30_000;
export const GOOGLE_CONNECTION_DOWN_TTL_MS = 10 * 60_000;
/** Re-sends of one row in a kick when it keeps changing during its send. */
export const GOOGLE_KICK_MAX_ROUNDS = 5;

/** Up to `perUser` rows per user, users interleaved, in the given order. */
export function fairBatch<T extends { userId: string }>(
  rows: T[],
  limit: number,
  perUser: number,
): T[] {
  const queues = new Map<string, T[]>();
  for (const row of rows) {
    const list = queues.get(row.userId) ?? [];
    if (list.length < perUser) list.push(row);
    queues.set(row.userId, list);
  }
  const out: T[] = [];
  for (let round = 0; round < perUser && out.length < limit; round += 1) {
    for (const list of queues.values()) {
      if (round < list.length && out.length < limit) out.push(list[round]);
    }
  }
  return out;
}

@Injectable()
export class PendingGoogleWriteService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingGoogleWriteService.name);
  /** Serialize syncs per task so two createEvent calls cannot race. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(PendingGoogleWrite)
    private readonly pendingRepo: Repository<PendingGoogleWrite>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
    private readonly google: GoogleCalendarService,
  ) {}

  /** True when this task should have a Google event for its seated interval. */
  canSyncTask(task: Task): boolean {
    if (task.isUnscheduled || isProblematicSchedule(task)) return false;
    if (!task.scheduledStartTime || !task.scheduledEndTime) return false;
    // Keep completed on the calendar (styled in the app). Canceled drops the event.
    if (task.status === 'canceled') {
      return false;
    }
    return true;
  }

  /** Series with no open seats should only drop Google after it has ended. */
  private recurringSeriesEnded(task: Task): boolean {
    if (!task.scheduledStartTime || !task.scheduledEndTime) return true;
    if (task.deadline && new Date(task.deadline).getTime() <= Date.now()) {
      return true;
    }
    return false;
  }

  /** Queue one Google write outside any transaction (a failed send, a delete). */
  async enqueue(
    userId: string,
    operation: PendingGoogleWriteOperation,
    opts: {
      taskId?: string | null;
      googleEventId?: string | null;
      googleCalendarId?: string | null;
      error?: string | null;
      /** When the queue may send it (default: one backoff step from now). */
      dueAt?: Date;
    },
  ): Promise<{ id: string; revision: number }> {
    return recordGoogleWrite(this.pendingRepo.manager, {
      userId,
      operation,
      ...opts,
      dueAt: opts.dueAt ?? new Date(Date.now() + GOOGLE_WRITE_BACKOFF_BASE_MS),
    });
  }

  onModuleInit(): void {
    // Rows written by the outbox inside a transaction are sent right after its commit.
    setGoogleOutboxKick((rowIds) => {
      void this.kickRows(rowIds).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Google outbox send failed: ${message}`);
      });
    });
    this.google.onReconnected((userId, opts) => {
      void (async () => {
        if (opts?.wasDisconnected) await this.reconcileUser(userId);
        await this.reviveForUser(userId);
      })().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Reviving Google writes for ${userId} failed: ${message}`);
      });
    });
  }

  /**
   * AUD-013: while a user had no grant, edits queued nothing. After a
   * reconnect that follows a disconnect, queue an upsert for every task Google
   * may have to change: open or future, recurring, or still holding an event
   * (parked meanwhile). Past seated tasks stay as they were. Sent by
   * `reviveForUser`.
   */
  async reconcileUser(userId: string): Promise<number> {
    const now = new Date();
    const tasks = await this.taskRepo.find({
      select: { id: true },
      where: [
        { userId, isRecurring: true },
        { userId, scheduledEndTime: MoreThan(now) },
        { userId, scheduledEndTime: IsNull(), googleEventId: Not(IsNull()) },
      ],
    });
    for (const { id } of tasks) {
      await recordGoogleWrite(this.pendingRepo.manager, { userId, operation: 'upsert', taskId: id, dueAt: now });
    }
    return tasks.length;
  }

  onModuleDestroy(): void {
    setGoogleOutboxKick(null);
  }

  /** Send a task's Google write in the background (the queue row is the record). */
  syncTaskSoon(userId: string, taskId: string): void {
    void this.syncTask(userId, taskId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Background Google sync failed for task ${taskId}: ${message}`,
      );
    });
  }

  /**
   * Make Google match the task now, through its queue row: record (or
   * refresh) the upsert row, claim it and send it. A failure stays on the row
   * (backoff, then `failed`); a row another worker holds is sent by that
   * worker, which re-runs it if this change came after its claim (revision).
   * Without a Google connection nothing is written.
   */
  async syncTask(userId: string, taskId: string): Promise<void> {
    if (!(await this.connected(userId))) return;
    const intent = await this.enqueue(userId, 'upsert', {
      taskId,
      dueAt: new Date(Date.now() + GOOGLE_WRITE_LEASE_MS),
    });
    await this.kickRows([intent.id]);
  }

  /** Claim and send these rows now (in-process one send per task at a time). */
  async kickRows(rowIds: string[]): Promise<number> {
    if (!rowIds.length) return 0;
    const rows = await this.pendingRepo.find({ where: { id: In(rowIds) } });
    let sent = 0;
    for (const row of rows) {
      if (row.status !== 'pending') continue;
      if (!(await this.connected(row.userId))) continue;
      await this.serialized(row, async () => {
        // Changed while it was being sent: send the newest state now (bounded).
        for (let round = 0; round < GOOGLE_KICK_MAX_ROUNDS; round += 1) {
          const fresh = await this.pendingRepo.findOne({ where: { id: row.id } });
          if (!fresh || fresh.status !== 'pending') return;
          if (!(await this.claim(fresh))) return;
          const result = await this.send(fresh);
          if (result !== 'failed') sent += 1;
          if (result !== 'again') return;
        }
      });
    }
    return sent;
  }

  /**
   * After a reconnect: waiting rows are due at once and terminally failed
   * ones get a fresh set of attempts. Upserts send the task's current state,
   * never a stale one; deletes skip events something still uses.
   */
  async reviveForUser(userId: string): Promise<number> {
    this.connection.delete(userId);
    const result = await this.pendingRepo.update(
      { userId, status: In(['failed', 'pending']) },
      { status: 'pending', attempts: 0, nextRunAt: null, leaseUntil: null },
    );
    const rows = await this.pendingRepo.find({ select: { id: true }, where: { userId, status: 'pending' } });
    await this.kickRows(rows.map((row) => row.id));
    return result.affected ?? 0;
  }

  /** Claim lease; renewed by a heartbeat while a send runs. Tests shorten it. */
  leaseMs = GOOGLE_WRITE_LEASE_MS;

  /** Recently seen connection state per user (a revoked grant is not re-checked every pass). */
  private readonly connection = new Map<string, { connected: boolean; at: number }>();

  private async connected(userId: string): Promise<boolean> {
    const cached = this.connection.get(userId);
    const ttl = cached?.connected ? GOOGLE_CONNECTION_OK_TTL_MS : GOOGLE_CONNECTION_DOWN_TTL_MS;
    if (cached && Date.now() - cached.at < ttl) return cached.connected;
    const { connected } = await this.google.checkConnection(userId);
    this.connection.set(userId, { connected, at: Date.now() });
    return connected;
  }

  private async serialized(row: PendingGoogleWrite, run: () => Promise<void>): Promise<void> {
    const key = `${row.userId}:${row.taskId ?? row.googleEventId ?? row.id}`;
    const previous = this.inflight.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(run);
    this.inflight.set(key, current);
    try {
      await current;
    } finally {
      if (this.inflight.get(key) === current) this.inflight.delete(key);
    }
  }

  /**
   * Drop queued upserts for a task that is being removed (its event gets a
   * delete row instead).
   */
  async discardPendingUpserts(userId: string, taskId: string): Promise<void> {
    await this.pendingRepo.delete({ userId, taskId, operation: 'upsert', status: Not('running') });
  }

  /** Wait until any in-flight send for this task finishes. */
  async waitForInflight(userId: string, taskId: string): Promise<void> {
    const run = this.inflight.get(`${userId}:${taskId}`);
    if (!run) return;
    await run.catch(() => undefined);
  }

  /**
   * Send due rows: claimed one at a time (safe with several instances), at
   * most GOOGLE_WRITE_PER_USER per user per pass so one user's backlog cannot
   * starve the others. No database transaction is open during a Google call.
   */
  async processQueue(limit = 20): Promise<number> {
    let done = 0;
    // A pass that only met disconnected users fetches again (they are moved
    // out of the due window first), so they cannot fill every pass (AUD-005).
    for (let round = 0; round < 3 && done < limit; round += 1) {
      const now = new Date();
      const due = await this.pendingRepo.find({
        where: [
          { status: 'pending', nextRunAt: IsNull() },
          { status: 'pending', nextRunAt: LessThanOrEqual(now) },
          { status: 'running', leaseUntil: LessThan(now) },
        ],
        order: { attempts: 'ASC', enqueuedAt: 'ASC' },
        take: limit * 5,
      });
      if (!due.length) break;
      const deferred = new Set<string>();
      for (const row of fairBatch(due, limit - done, GOOGLE_WRITE_PER_USER)) {
        if (deferred.has(row.userId)) continue;
        // Disconnected / revoked: the rows wait (no attempt spent) until a
        // reconnect revives them, or the next check after the down TTL.
        if (!(await this.connected(row.userId))) {
          await this.deferUser(row.userId, now);
          deferred.add(row.userId);
          continue;
        }
        await this.serialized(row, async () => {
          if ((await this.claim(row)) && (await this.send(row)) !== 'failed') done += 1;
        });
      }
      if (!deferred.size) break;
    }
    return done;
  }

  /** Move a disconnected user's due pending rows out of the due window, attempts untouched. */
  private async deferUser(userId: string, now: Date): Promise<void> {
    const later = new Date(now.getTime() + GOOGLE_CONNECTION_DOWN_TTL_MS);
    await this.pendingRepo.update(
      { userId, status: 'pending', nextRunAt: IsNull() },
      { nextRunAt: later },
    );
    await this.pendingRepo.update(
      { userId, status: 'pending', nextRunAt: LessThanOrEqual(now) },
      { nextRunAt: later },
    );
  }

  /** Compare-and-set on the row as read: of two workers, one wins. */
  private async claim(row: PendingGoogleWrite): Promise<boolean> {
    const result = await this.pendingRepo.update(
      { id: row.id, status: row.status, attempts: row.attempts, revision: row.revision },
      {
        status: 'running',
        attempts: row.attempts + 1,
        leaseUntil: new Date(Date.now() + this.leaseMs),
      },
    );
    if (!result.affected) return false;
    row.attempts += 1;
    return true;
  }

  /**
   * Perform one claimed row. `again`: sent, but the task changed during the
   * send (newer revision), so the row is pending again for the newest state.
   * Every outcome is written only while this worker still owns the claim
   * (status running + the attempts it claimed): a worker whose lease was
   * taken over cannot overwrite the newer one (AUD-007).
   */
  private async send(row: PendingGoogleWrite): Promise<'sent' | 'again' | 'failed'> {
    const owned = { id: row.id, status: 'running' as const, attempts: row.attempts };
    // A live sender keeps its lease; a dead one stops renewing and is taken over.
    const heartbeat = setInterval(() => {
      void this.pendingRepo
        .update(owned, { leaseUntil: new Date(Date.now() + this.leaseMs) })
        .catch(() => undefined);
    }, Math.max(50, Math.floor(this.leaseMs / 4)));
    try {
      return await this.sendOwned(row, owned);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async sendOwned(
    row: PendingGoogleWrite,
    owned: { id: string; status: 'running'; attempts: number },
  ): Promise<'sent' | 'again' | 'failed'> {
    try {
      if (row.operation === 'delete') {
        await this.processDelete(row);
      } else {
        await this.processUpsert(row);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = row.attempts >= GOOGLE_WRITE_MAX_ATTEMPTS;
      const delay = Math.min(
        GOOGLE_WRITE_BACKOFF_MAX_MS,
        GOOGLE_WRITE_BACKOFF_BASE_MS * 2 ** (row.attempts - 1),
      );
      const retry = {
        status: 'pending' as const,
        leaseUntil: null,
        nextRunAt: new Date(Date.now() + delay),
        lastError: message.slice(0, 2000),
        // The failed request may still have reached Google: an `updated`
        // from it must not count as a user edit later (AUD-010).
        enqueuedAt: new Date(),
      };
      let terminal = false;
      if (final) {
        // Terminal only for the revision this attempt sent (AUD-023).
        const failed = await this.pendingRepo.update(
          { ...owned, revision: row.revision },
          { status: 'failed', leaseUntil: null, nextRunAt: null, lastError: message.slice(0, 2000) },
        );
        terminal = !!failed.affected;
        // A newer change arrived during the send: that is new work.
        if (!terminal) await this.pendingRepo.update(owned, { ...retry, attempts: 0 });
      } else {
        await this.pendingRepo.update(owned, retry);
      }
      if (terminal) {
        this.logger.error(
          `Pending Google ${row.operation} ${row.id} failed after ${row.attempts} attempts: ${message}`,
        );
      } else {
        this.logger.warn(
          `Pending Google ${row.operation} ${row.id} attempt ${row.attempts} failed (${message}); retry in ${delay} ms`,
        );
      }
      return 'failed';
    }
    // Sent. A failure queued meanwhile (newer revision) is work this pass did
    // not see: put the row back instead of deleting it.
    const removed = await this.pendingRepo.delete({ ...owned, revision: row.revision });
    if (!removed.affected) {
      const requeued = await this.pendingRepo.update(
        owned,
        // We just wrote: our own `updated` is not a user edit (AUD-010).
        { status: 'pending', leaseUntil: null, nextRunAt: null, enqueuedAt: new Date() },
      );
      // Not ours any more (taken over): the new owner finishes it.
      return requeued.affected ? 'again' : 'sent';
    }
    return 'sent';
  }

  private async processUpsert(row: PendingGoogleWrite): Promise<void> {
    if (!row.taskId) {
      return;
    }
    const task = await this.taskRepo.findOne({
      where: { id: row.taskId, userId: row.userId },
      relations: ['phase', 'phases'],
    });
    if (!task) {
      // Task was deleted while this upsert was queued — drop any stale Google id.
      if (row.googleEventId) {
        await this.deleteGoogleEventQuietly(
          row.userId,
          row.googleEventId,
          row.googleCalendarId ?? 'primary',
        );
      }
      return;
    }
    if (!this.canSyncTask(task)) {
      await this.deleteTaskGoogle(row.userId, task);
      return;
    }

    const calendarId =
      row.googleCalendarId || task.googleEventCalendarId || 'primary';
    const local = {
      summary: task.name,
      description: task.description ?? '',
      startIso: task.scheduledStartTime?.toISOString() ?? null,
      endIso: task.scheduledEndTime?.toISOString() ?? null,
    };

    if (task.googleEventId || row.googleEventId) {
      const eventId = task.googleEventId || row.googleEventId!;
      try {
        // A write that waited (retries, reconnect): an edit made in Google
        // since the last local change wins. Sent right after the change, the
        // local state is the newest and no extra read is spent.
        // A series is never pulled: its Google start is DTSTART (often past),
        // not the next occurrence the task holds (AUD-009).
        const waited =
          !task.isRecurring && Date.now() - new Date(row.enqueuedAt).getTime() > GOOGLE_WRITE_LEASE_MS;
        if (waited) {
          const remote = await this.google.getEvent(
            row.userId,
            eventId,
            calendarId,
          );
          const fields = googleEventFieldsFromApi(remote);
          if (
            googleContentDiffers(local, fields) &&
            googleEditedAfterEnqueue(fields.updatedIso, row.enqueuedAt)
          ) {
            await this.pullGoogleOntoTask(task, fields);
            return;
          }
        }
        if (task.isRecurring) {
          await this.writeRecurringSeries(row.userId, task, calendarId);
          return;
        }
        await this.google.updateEvent(
          row.userId,
          eventId,
          await this.buildPayload(task),
          { skipSleepWindowCheck: true, calendarId },
        );
        // Deleted while the update was in flight: do not leave its event behind.
        if (!(await this.taskStillExists(row.userId, task.id))) {
          await this.deleteGoogleEventQuietly(row.userId, eventId, calendarId);
          return;
        }
        await this.stampOpenSlotGoogle(task);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Only a confirmed 404/410 means deleted in Google; anything else retries.
        if (isGoogleEventMissing(err)) {
          await this.handleMissingGoogleEvent(row.userId, task, eventId);
          return;
        }
        throw err;
      }
    }

    if (task.isRecurring) {
      await this.writeRecurringSeries(row.userId, task, calendarId);
      return;
    }
    const ev = await this.createTaskEvent(
      row.userId,
      task,
      await this.buildPayload(task),
      {
        skipSleepWindowCheck: true,
        calendarId,
      },
    );
    await this.attachCreatedGoogleEvent(row.userId, task, ev, calendarId);
  }

  /**
   * Insert the task's Google event under an id stored before the call, so a
   * retry after an unknown outcome finds the first event (409) instead of
   * creating a second one — also across instances.
   */
  private async createTaskEvent(
    userId: string,
    task: Task,
    payload: Record<string, unknown>,
    opts: { skipSleepWindowCheck: true; calendarId: string },
  ): Promise<{ id?: string | null; appCalendarId?: string; status?: string | null }> {
    if (!task.googleInsertEventId) {
      // Google event ids: base32hex (0-9, a-v), 5–1024 chars. Hex qualifies.
      const fresh = randomUUID().replace(/-/g, '');
      await this.taskRepo.update(
        { id: task.id, googleInsertEventId: IsNull() },
        { googleInsertEventId: fresh },
      );
      const stored = await this.taskRepo.findOne({
        where: { id: task.id },
        select: ['id', 'googleInsertEventId'],
      });
      task.googleInsertEventId = stored?.googleInsertEventId ?? fresh;
    }
    const ev = await this.google.createEvent(
      userId,
      { ...payload, id: task.googleInsertEventId },
      opts,
    );
    if (ev?.status === 'cancelled') {
      // Our event was created and then deleted in Google: that id is spent.
      await this.taskRepo.update({ id: task.id }, { googleInsertEventId: null });
      task.googleInsertEventId = null;
      throw new Error('Google event was deleted before it was linked; will create a new one');
    }
    return ev;
  }

  private async taskStillExists(
    userId: string,
    taskId: string,
  ): Promise<boolean> {
    const row = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      select: ['id'],
    });
    return !!row;
  }

  /**
   * Persist a newly created Google event only if the local task still exists.
   * Otherwise delete the orphan so a racing task-delete cannot resurrect it.
   */
  private async attachCreatedGoogleEvent(
    userId: string,
    task: Task,
    ev: { id?: string | null; appCalendarId?: string } | null | undefined,
    calendarId: string,
  ): Promise<void> {
    if (typeof ev?.id !== 'string') return;
    if (!(await this.taskStillExists(userId, task.id))) {
      await this.deleteGoogleEventQuietly(userId, ev.id, calendarId);
      return;
    }
    task.googleEventId = ev.id;
    task.googleInsertEventId = null;
    if (ev.appCalendarId) task.googleEventCalendarId = ev.appCalendarId;
    // Link columns only: `task` was read before the Google call, and a full
    // save would overwrite whatever the user changed meanwhile.
    await this.taskRepo.update(
      { id: task.id },
      {
        googleEventId: task.googleEventId,
        googleEventCalendarId: task.googleEventCalendarId,
        googleInsertEventId: null,
      },
    );
    await this.stampOpenSlotGoogle(task);
  }

  private async deleteGoogleEventQuietly(
    userId: string,
    eventId: string,
    calendarId: string,
  ): Promise<void> {
    try {
      await this.google.deleteEvent(userId, eventId, calendarId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isGoogleEventMissing(err)) return;
      await this.enqueue(userId, 'delete', {
        googleEventId: eventId,
        googleCalendarId: calendarId,
        error: message,
      });
    }
  }

  private async processDelete(row: PendingGoogleWrite): Promise<void> {
    if (!row.googleEventId) return;
    // Obsolete: a task or slot uses this event again (never delete live data).
    const inUse =
      (await this.taskRepo.count({ where: { userId: row.userId, googleEventId: row.googleEventId } })) +
      (await this.scheduledRepo.count({ where: { googleEventId: row.googleEventId } }));
    if (inUse) return;
    try {
      await this.google.deleteEvent(
        row.userId,
        row.googleEventId,
        row.googleCalendarId ?? undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isGoogleEventMissing(err)) return;
      throw err;
    }
  }

  private async handleMissingGoogleEvent(
    userId: string,
    task: Task,
    eventId: string,
  ): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: { userId } });
    if (settings?.syncGoogleDeletions) {
      // Confirmed 404/410 only (AUD-001). Slots and task go together.
      await this.taskRepo.manager.transaction(async (manager) => {
        await manager.getRepository(ScheduledTask).delete({ taskId: task.id });
        await manager.getRepository(Task).delete({ id: task.id, userId });
      });
      return;
    }
    // Unlink only if the task still points at that event (no stale overwrite).
    await this.taskRepo.update(
      { id: task.id, googleEventId: eventId },
      { googleEventId: null, googleEventCalendarId: null },
    );
  }

  private async pullGoogleOntoTask(
    task: Task,
    fields: ReturnType<typeof googleEventFieldsFromApi>,
  ): Promise<void> {
    // The pulled columns only (the Google edit wins for these, nothing else).
    const pulled: Partial<Task> = {};
    if (fields.summary) pulled.name = fields.summary;
    if (fields.description !== undefined) pulled.description = fields.description ?? '';
    if (fields.startIso) pulled.scheduledStartTime = new Date(fields.startIso);
    if (fields.endIso) pulled.scheduledEndTime = new Date(fields.endIso);
    Object.assign(task, pulled);
    if (Object.keys(pulled).length) await this.taskRepo.update({ id: task.id }, pulled);
    const now = Date.now();
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (open.length === 1 && task.scheduledStartTime && task.scheduledEndTime) {
      await this.scheduledRepo.update(
        { id: open[0].id },
        { scheduledStartTime: task.scheduledStartTime, scheduledEndTime: task.scheduledEndTime },
      );
    }
  }

  private async deleteTaskGoogle(userId: string, task: Task): Promise<void> {
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const ids = new Set<string>();
    if (task.googleEventId) ids.add(task.googleEventId);
    // AUD-012: an insert whose answer was lost may have created this event.
    if (task.googleInsertEventId) ids.add(task.googleInsertEventId);
    for (const row of rows) {
      if (row.googleEventId) ids.add(row.googleEventId);
    }
    const calendarId = task.googleEventCalendarId ?? 'primary';
    for (const eventId of ids) {
      try {
        await this.google.deleteEvent(userId, eventId, calendarId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isGoogleEventMissing(err)) continue;
        await this.enqueue(userId, 'delete', {
          taskId: task.id,
          googleEventId: eventId,
          googleCalendarId: calendarId,
          error: message,
        });
      }
    }
    if (task.googleEventId || task.googleEventCalendarId || task.googleInsertEventId) {
      task.googleEventId = null;
      task.googleEventCalendarId = null;
      task.googleInsertEventId = null;
      await this.taskRepo.update(
        { id: task.id },
        { googleEventId: null, googleEventCalendarId: null, googleInsertEventId: null },
      );
    }
    for (const row of rows) {
      if (row.googleEventId) {
        await this.scheduledRepo.update(
          { id: row.id },
          { googleEventId: null, googleEventCalendarId: null },
        );
      }
    }
  }

  private async stampOpenSlotGoogle(task: Task): Promise<void> {
    if (!task.googleEventId) return;
    const now = Date.now();
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (!task.isRecurring) {
      if (open.length !== 1) return;
    }
    const link = { googleEventId: task.googleEventId, googleEventCalendarId: task.googleEventCalendarId };
    for (const row of open) await this.scheduledRepo.update({ id: row.id }, link);
  }

  /**
   * Extend the Google series that already exists: keep its DTSTART and move
   * only RRULE UNTIL to the last open day. A new event is created only when
   * this segment has never been written. An earlier segment with no open days
   * is capped in place so its past instances stay.
   */
  private async writeRecurringSeries(
    userId: string,
    task: Task,
    calendarId: string,
  ): Promise<void> {
    const syncOpts = { skipSleepWindowCheck: true as const, calendarId };
    const open = await this.openSlots(task.id);
    const all = await this.allSlots(task.id);
    if (!open.length) {
      const past = all.filter(
        (row) => new Date(row.scheduledEndTime).getTime() <= Date.now(),
      );
      if (past.length && task.googleEventId) {
        await this.google.capRecurringSeriesUntil(
          userId,
          task.googleEventId,
          new Date(past[past.length - 1].scheduledStartTime),
          calendarId,
        );
        return;
      }
      // No seats yet during a move: keep the event. Delete only a finished series.
      if (this.recurringSeriesEnded(task)) {
        await this.deleteTaskGoogle(userId, task);
      }
      return;
    }

    const timeZone = resolveIanaTimeZone(task.scheduleTimeZone);
    const preferredHm = task.scheduledStartTime
      ? localHm(new Date(task.scheduledStartTime).toISOString(), timeZone)
      : null;
    const openAnchor =
      pickMajorityClockSlot(open, timeZone, preferredHm) ?? open[0];
    const openStart = new Date(openAnchor.scheduledStartTime);
    const openEnd = new Date(openAnchor.scheduledEndTime);
    const duration = Math.max(60_000, openEnd.getTime() - openStart.getTime());
    const openHm = localHm(openStart.toISOString(), timeZone);
    const sameClock = all.filter(
      (row) =>
        localHm(new Date(row.scheduledStartTime).toISOString(), timeZone) ===
        openHm,
    );
    const earliest =
      pickMajorityClockSlot(sameClock, timeZone, preferredHm) ?? openAnchor;
    let start = new Date(earliest.scheduledStartTime);
    let end = new Date(start.getTime() + duration);
    if (task.googleEventId) {
      const remoteStart = await this.remoteSeriesStart(
        userId,
        task.googleEventId,
        calendarId,
      );
      if (remoteStart) {
        start = remoteStart;
        end = new Date(remoteStart.getTime() + duration);
      }
    }

    const payload = this.seriesPayload(task, start, end, open, all, timeZone);
    if (task.googleEventId) {
      await this.google.updateEvent(
        userId,
        task.googleEventId,
        payload,
        syncOpts,
      );
      if (!(await this.taskStillExists(userId, task.id))) {
        await this.deleteGoogleEventQuietly(
          userId,
          task.googleEventId,
          calendarId,
        );
        return;
      }
      await this.stampOpenSlotGoogle(task);
      return;
    }
    const ev = await this.createTaskEvent(userId, task, payload, syncOpts);
    await this.attachCreatedGoogleEvent(userId, task, ev, calendarId);
  }

  private seriesPayload(
    task: Task,
    start: Date,
    end: Date,
    open: ScheduledTask[],
    all: ScheduledTask[],
    timeZone: string,
  ): Record<string, unknown> {
    const phase = task.phases?.[0] ?? task.phase;
    const fallbackColorId = phaseHexToGoogleColorId(phase?.color);
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
    };
    applyTaskGoogleEventFields(payload, task, fallbackColorId);
    const last = open[open.length - 1];
    const phases = [
      ...(task.phases ?? []),
      ...(task.phase ? [task.phase] : []),
    ];
    payload.recurrence = buildGoogleRecurrenceRules({
      pattern: task.recurrencePattern,
      timeZone,
      anchorStart: task.earliestStartTime,
      firstStart: start,
      lastStart: new Date(last.scheduledStartTime),
      weekDays: effectiveRecurrenceWeekDays(task.recurrenceWeekDays, phases),
      excludeStarts: excludeStartsForSkippedYmds({
        skippedYmds: task.skippedOccurrenceYmds,
        firstStart: start,
        lastStart: new Date(last.scheduledStartTime),
        timeZone,
        placedYmds: all.map((row) =>
          localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone),
        ),
      }),
    });
    return payload;
  }

  private async remoteSeriesStart(
    userId: string,
    eventId: string,
    calendarId: string,
  ): Promise<Date | null> {
    try {
      const ev = (await this.google.getEvent(userId, eventId, calendarId)) as {
        start?: { dateTime?: string | null };
      } | null;
      const iso = ev?.start?.dateTime;
      if (typeof iso !== 'string') return null;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? new Date(ms) : null;
    } catch {
      return null;
    }
  }

  private async buildPayload(task: Task): Promise<Record<string, unknown>> {
    const phase = task.phases?.[0] ?? task.phase;
    const fallbackColorId = phaseHexToGoogleColorId(phase?.color);
    const timeZone = resolveIanaTimeZone(task.scheduleTimeZone);
    const open = await this.openSlots(task.id);
    const preferredHm = task.scheduledStartTime
      ? localHm(new Date(task.scheduledStartTime).toISOString(), timeZone)
      : null;
    const anchor =
      task.isRecurring && open.length
        ? pickMajorityClockSlot(open, timeZone, preferredHm)
        : open[0] ?? null;
    const start =
      anchor?.scheduledStartTime ?? task.scheduledStartTime ?? null;
    const end = anchor?.scheduledEndTime ?? task.scheduledEndTime ?? null;
    if (
      task.scheduledStartTime &&
      task.scheduledEndTime &&
      start &&
      end &&
      (Math.abs(new Date(start).getTime() - new Date(task.scheduledStartTime).getTime()) >
        1000 ||
        Math.abs(new Date(end).getTime() - new Date(task.scheduledEndTime).getTime()) >
          1000)
    ) {
      this.logger.warn(
        `Google sync for "${task.name}" publishes slot ${new Date(start).toISOString()}–${new Date(end).toISOString()} instead of task ${new Date(task.scheduledStartTime).toISOString()}–${new Date(task.scheduledEndTime).toISOString()}`,
      );
    }
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: {
        dateTime: start?.toISOString(),
        timeZone,
      },
      end: {
        dateTime: end?.toISOString(),
        timeZone,
      },
    };
    applyTaskGoogleEventFields(payload, task, fallbackColorId);
    if (task.isRecurring && open.length) {
      const first = anchor ?? open[0];
      const last = open[open.length - 1];
      const phases = [
        ...(task.phases ?? []),
        ...(task.phase ? [task.phase] : []),
      ];
      payload.recurrence = buildGoogleRecurrenceRules({
        pattern: task.recurrencePattern,
        timeZone,
        anchorStart: task.earliestStartTime,
        firstStart: first.scheduledStartTime,
        lastStart: last.scheduledStartTime,
        weekDays: effectiveRecurrenceWeekDays(task.recurrenceWeekDays, phases),
        excludeStarts: excludeStartsForSkippedYmds({
          skippedYmds: task.skippedOccurrenceYmds,
          firstStart: open[0].scheduledStartTime,
          lastStart: last.scheduledStartTime,
          timeZone,
          placedYmds: open.map((row) =>
            localYmd(row.scheduledStartTime.toISOString(), timeZone),
          ),
        }),
      });
    }
    return payload;
  }

  private async allSlots(taskId: string): Promise<ScheduledTask[]> {
    const rows = await this.scheduledRepo.find({ where: { taskId } });
    return [...rows].sort(
      (a, b) =>
        new Date(a.scheduledStartTime).getTime() -
        new Date(b.scheduledStartTime).getTime(),
    );
  }

  private async openSlots(taskId: string): Promise<ScheduledTask[]> {
    const now = Date.now();
    const rows = await this.allSlots(taskId);
    return rows.filter((row) => new Date(row.scheduledEndTime).getTime() > now);
  }
}
