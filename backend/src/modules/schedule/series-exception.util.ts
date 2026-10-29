import { Repository } from 'typeorm';
import { Phase } from '../phases/entities/phase.entity';
import {
  clearedParkColumns,
  parkedDays,
  ScheduleState,
  Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import { addSkippedOccurrenceYmd } from '../tasks/skipped-occurrence.util';
import { localYmd } from '../voice/voice-local-date.util';
import { ScheduledTask } from './schedule.entity';

/**
 * Series exceptions written inside the caller's transaction (PE-18): the
 * repositories passed in belong to that transaction. Nothing here talks to
 * Google; callers sync after the commit.
 *
 * Occurrence identity: a day of a series is (series group, civil day). A
 * detached copy carries `seriesGroupId` + `originalOccurrenceYmd`, so a retry
 * finds the copy it already made instead of making a second one.
 */
export type SeriesExceptionRepos = {
  tasks: Repository<Task>;
  slots: Repository<ScheduledTask>;
};

/** Remove one civil day from a series: skip it, drop its open slot, answer it in the inbox. */
export async function skipSeriesDay(
  repos: SeriesExceptionRepos,
  series: Task,
  occurrenceYmd: string,
  timeZone: string,
  now: Date,
): Promise<void> {
  series.skippedOccurrenceYmds = addSkippedOccurrenceYmd(
    series.skippedOccurrenceYmds,
    occurrenceYmd,
  );
  if (series.scheduleState === ScheduleState.PROBLEMATIC) {
    const left = parkedDays(series).filter((ymd) => ymd !== occurrenceYmd);
    if (left.length) {
      series.problematicOccurrenceYmds = left;
      series.problematicDay = left[0];
    } else {
      Object.assign(series, clearedParkColumns());
    }
  }
  await repos.tasks.save(series);
  const rows = await repos.slots.find({ where: { taskId: series.id } });
  const open = rows.filter(
    (row) =>
      new Date(row.scheduledEndTime).getTime() > now.getTime() &&
      localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone) === occurrenceYmd,
  );
  if (open.length) await repos.slots.remove(open);
}

/**
 * The one-off copy that stands for `occurrenceYmd` of `series`: the existing
 * one when a previous attempt already made it, else a new one. Same type,
 * name and look as the series; times are the chosen interval.
 */
export async function findOrCreateDayCopy(
  repos: SeriesExceptionRepos,
  series: Task,
  occurrenceYmd: string,
  slot: { start: Date; end: Date; minutes: number; phases: Phase[] },
): Promise<Task> {
  const groupId = series.seriesGroupId ?? series.id;
  const existing = await repos.tasks.findOne({
    where: {
      userId: series.userId,
      seriesGroupId: groupId,
      originalOccurrenceYmd: occurrenceYmd,
      isRecurring: false,
    },
    relations: ['phases'],
  });
  const copy =
    existing ??
    repos.tasks.create({
      userId: series.userId,
      name: series.name,
      description: series.description,
      eventType: series.eventType,
      isRecurring: false,
      recurrencePattern: null,
      recurrenceWeekDays: null,
      allowSplit: series.allowSplit,
      priority: series.priority,
      scheduleTimeZone: series.scheduleTimeZone,
      status: TaskStatus.TODO,
      location: series.location,
      googleColorId: series.googleColorId,
      googleVisibility: series.googleVisibility,
      googleTransparency: series.googleTransparency,
      googleReminders: series.googleReminders,
      scheduleState: ScheduleState.NONE,
      isUnscheduled: false,
      parentSeriesId: series.id,
      seriesGroupId: groupId,
      originalOccurrenceYmd: occurrenceYmd,
    });
  copy.phases = slot.phases;
  copy.phaseId = slot.phases[0]?.id ?? null;
  copy.estimatedTimeInMinutes = slot.minutes;
  copy.scheduledStartTime = slot.start;
  copy.scheduledEndTime = slot.end;
  return repos.tasks.save(copy);
}
