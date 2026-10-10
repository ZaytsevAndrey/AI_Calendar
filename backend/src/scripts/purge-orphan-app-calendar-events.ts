/**
 * Remove Google events on the app calendar that no local task/habit owns.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/purge-orphan-app-calendar-events.ts
 *   npx ts-node src/scripts/purge-orphan-app-calendar-events.ts --apply
 *   npx ts-node src/scripts/purge-orphan-app-calendar-events.ts --apply --user=<userId>
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { GoogleCalendarService } from '../modules/google-calendar/google-calendar.service';
import { PendingGoogleWrite } from '../modules/google-calendar/entities/pending-google-write.entity';
import { Habit } from '../modules/habits/entities/habit.entity';
import { ScheduledTask } from '../modules/schedule/schedule.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { UserSettings } from '../modules/user-settings/entities/user-settings.entity';

type ListedEvent = {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  recurringEventId?: string | null;
  start?: { dateTime?: string | null; date?: string | null };
  end?: { dateTime?: string | null; date?: string | null };
};

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function listAllAppEvents(
  google: GoogleCalendarService,
  userId: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<ListedEvent[]> {
  const out: ListedEvent[] = [];
  let pageToken: string | undefined;
  do {
    const page = await google.getEvents(
      userId,
      timeMin,
      timeMax,
      250,
      pageToken,
      calendarId,
    );
    for (const ev of page.events ?? []) {
      out.push(ev as ListedEvent);
    }
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function knownGoogleEventIds(
  tasks: Repository<Task>,
  habits: Repository<Habit>,
  slots: Repository<ScheduledTask>,
  userId: string,
): Promise<Set<string>> {
  const known = new Set<string>();
  const taskRows = await tasks.find({
    where: { userId },
    select: ['id', 'googleEventId'],
  });
  for (const row of taskRows) {
    if (row.googleEventId) known.add(row.googleEventId);
  }
  const habitRows = await habits.find({
    where: { userId },
    select: ['id', 'googleEventId'],
  });
  for (const row of habitRows) {
    if (row.googleEventId) known.add(row.googleEventId);
  }
  const slotRows = await slots
    .createQueryBuilder('st')
    .innerJoin('st.task', 't')
    .where('t.userId = :userId', { userId })
    .andWhere('st.googleEventId IS NOT NULL')
    .select(['st.id', 'st.googleEventId'])
    .getMany();
  for (const row of slotRows) {
    if (row.googleEventId) known.add(row.googleEventId);
  }
  return known;
}

function orphanMasterIds(
  events: ListedEvent[],
  known: Set<string>,
): Map<string, { summary: string; sampleStart: string }> {
  const orphans = new Map<string, { summary: string; sampleStart: string }>();
  for (const ev of events) {
    if (!ev.id || ev.status === 'cancelled') continue;
    const masterId = ev.recurringEventId || ev.id;
    if (known.has(ev.id) || known.has(masterId)) continue;
    if (orphans.has(masterId)) continue;
    orphans.set(masterId, {
      summary: (ev.summary ?? '(no title)').trim() || '(no title)',
      sampleStart: ev.start?.dateTime || ev.start?.date || '?',
    });
  }
  return orphans;
}

async function purgeDeadPendingDeletes(
  pendingRepo: Repository<PendingGoogleWrite>,
  tasks: Repository<Task>,
  userId: string,
  apply: boolean,
): Promise<number> {
  const rows = await pendingRepo.find({ where: { userId, operation: 'delete' } });
  const doomed: PendingGoogleWrite[] = [];
  for (const row of rows) {
    const goneOnGoogle =
      typeof row.lastError === 'string' &&
      /Resource has been deleted|404|Not Found/i.test(row.lastError);
    let taskMissing = false;
    if (row.taskId) {
      const task = await tasks.findOne({
        where: { id: row.taskId, userId },
        select: ['id'],
      });
      taskMissing = !task;
    }
    if (goneOnGoogle || taskMissing) doomed.push(row);
  }
  if (apply && doomed.length) await pendingRepo.remove(doomed);
  return doomed.length;
}

async function main() {
  const apply = argFlag('--apply');
  const onlyUser = argValue('--user');
  const pastDays = Number(argValue('--past-days') ?? '120');
  const futureDays = Number(argValue('--future-days') ?? '90');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const google = app.get(GoogleCalendarService);
    const settingsRepo = app.get<Repository<UserSettings>>(
      getRepositoryToken(UserSettings),
    );
    const tasks = app.get<Repository<Task>>(getRepositoryToken(Task));
    const habits = app.get<Repository<Habit>>(getRepositoryToken(Habit));
    const slots = app.get<Repository<ScheduledTask>>(
      getRepositoryToken(ScheduledTask),
    );
    const pendingRepo = app.get<Repository<PendingGoogleWrite>>(
      getRepositoryToken(PendingGoogleWrite),
    );

    const settings = await settingsRepo.find({
      where: onlyUser ? { userId: onlyUser } : {},
    });
    const timeMin = addDaysIso(-Math.abs(pastDays));
    const timeMax = addDaysIso(Math.abs(futureDays));

    console.log(
      apply
        ? 'APPLY mode: orphans will be deleted from Google.'
        : 'DRY-RUN (pass --apply to delete).',
    );
    console.log(`Window: ${timeMin} … ${timeMax}`);

    for (const s of settings) {
      if (!s.googleCalendarLinked || !s.appGoogleCalendarId) {
        console.log(`\nSkip user ${s.userId}: no linked app calendar`);
        continue;
      }
      const calendarId = s.appGoogleCalendarId;
      const calName = s.appGoogleCalendarName?.trim() || calendarId;
      console.log(`\n=== user ${s.userId} / ${calName} ===`);

      const known = await knownGoogleEventIds(tasks, habits, slots, s.userId);
      console.log(`Local Google ids kept: ${known.size}`);

      const events = await listAllAppEvents(
        google,
        s.userId,
        calendarId,
        timeMin,
        timeMax,
      );
      console.log(`App-calendar events in window: ${events.length}`);

      const suspicious = events.filter((ev) =>
        /shower/i.test(ev.summary ?? ''),
      );
      if (suspicious.length) {
        console.log(`Events matching /shower/i: ${suspicious.length}`);
        for (const ev of suspicious) {
          const masterId = ev.recurringEventId || ev.id || '?';
          const kept =
            (!!ev.id && known.has(ev.id)) || known.has(masterId);
          console.log(
            `  - ${ev.summary} id=${ev.id} recurringEventId=${ev.recurringEventId ?? 'null'} kept=${kept}`,
          );
        }
      }

      const orphans = orphanMasterIds(events, known);
      if (!orphans.size) {
        console.log('No orphan events.');
      } else {
        console.log(`Orphan series/one-offs: ${orphans.size}`);
        for (const [id, meta] of orphans) {
          console.log(`  - ${meta.summary} @ ${meta.sampleStart} (${id})`);
          if (apply) {
            try {
              await google.deleteEvent(s.userId, id, calendarId);
              console.log(`    deleted`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn(`    delete failed: ${message}`);
            }
          }
        }
      }

      const pendingN = await purgeDeadPendingDeletes(
        pendingRepo,
        tasks,
        s.userId,
        apply,
      );
      console.log(
        apply
          ? `Removed dead pending_google_writes deletes: ${pendingN}`
          : `Dead pending_google_writes deletes (would remove): ${pendingN}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
