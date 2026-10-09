import { eventsApi } from 'api/eventsApi';
import { eventTasksApi } from 'api/eventTasksApi';
import { habitsApi } from 'api/habitsApi';
import type { HabitAchievementId, HabitDTO } from 'api/habits.api';
import { ScheduleApi } from 'api/schedule.api';
import type { SkipOccurrenceDTO, UpdateTaskDTO } from 'api/tasks.api';
import type { VoiceCommandAction } from 'api/voice.api';
import apiCall from 'modules/common/utils/apiCall';
import i18n from 'i18n';
import { settleReplanJob } from 'modules/schedule/settleReplanJob';
import {
  startTaskMutationProgress,
  type TaskMutationProgressHandle,
} from 'modules/schedule/taskMutationProgress';
import { showSuccessToast } from 'utils/toast';

type Mutation<T> = (arg: T) => { unwrap: () => Promise<unknown> };

type ExecuteDeps = {
  updateTask: Mutation<{ id: string; body: UpdateTaskDTO }>;
  skipOccurrence: Mutation<{ id: string; body: SkipOccurrenceDTO }>;
  deleteTask: Mutation<string>;
  dispatch: (action: any) => void;
};

function refreshCalendar(dispatch: (action: any) => void): void {
  dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
  dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
}

function isStreakAchievement(id: HabitAchievementId): boolean {
  return id.startsWith('streak_');
}

export async function executeVoiceCommand(
  command: VoiceCommandAction,
  deps: ExecuteDeps,
): Promise<void> {
  if (command.kind === 'habit_check_in') {
    const response = await apiCall({
      url: `/habits/${command.habitId}/check-ins`,
      method: 'POST',
      data: { date: command.date },
    });
    const habit = response.data as HabitDTO;
    deps.dispatch(habitsApi.util.invalidateTags([{ type: 'Habits', id: 'LIST' }]));
    showSuccessToast({
      title: i18n.t('voice.habitCheckedIn'),
      detail: command.habitName,
    });
    let tipShown = false;
    for (const id of habit.newlyUnlocked ?? []) {
      const useTip =
        !tipShown && Boolean(habit.streakTip) && isStreakAchievement(id);
      showSuccessToast({
        title: useTip
          ? i18n.t('habits.streakTipTitle')
          : i18n.t('habits.achievements.unlocked'),
        detail: useTip ? habit.streakTip : i18n.t(`habits.achievements.${id}`),
      });
      if (useTip) tipShown = true;
    }
    return;
  }

  if (command.kind === 'habit_create') {
    await apiCall({
      url: '/habits',
      method: 'POST',
      data: command.fields,
    });
    deps.dispatch(habitsApi.util.invalidateTags([{ type: 'Habits', id: 'LIST' }]));
    showSuccessToast({
      title: i18n.t('voice.habitCreated'),
      detail: command.fields.name,
    });
    return;
  }

  if (command.kind === 'habit_update') {
    await apiCall({
      url: `/habits/${command.habitId}`,
      method: 'PATCH',
      data: command.patch,
    });
    deps.dispatch(habitsApi.util.invalidateTags([{ type: 'Habits', id: 'LIST' }]));
    showSuccessToast({
      title: i18n.t('voice.habitUpdated'),
      detail: command.habitName,
    });
    return;
  }

  if (command.kind === 'habit_delete') {
    await apiCall({
      url: `/habits/${command.habitId}`,
      method: 'DELETE',
    });
    deps.dispatch(habitsApi.util.invalidateTags([{ type: 'Habits', id: 'LIST' }]));
    showSuccessToast({
      title: i18n.t('voice.habitDeleted'),
      detail: command.habitName,
    });
    return;
  }

  if (command.kind === 'habit_uncheck') {
    await apiCall({
      url: `/habits/${command.habitId}/check-ins/${command.date}`,
      method: 'DELETE',
    });
    deps.dispatch(habitsApi.util.invalidateTags([{ type: 'Habits', id: 'LIST' }]));
    showSuccessToast({
      title: i18n.t('voice.habitUnchecked'),
      detail: command.habitName,
    });
    return;
  }

  if (command.kind === 'complete') {
    // Progress toast from eventTasksApi.updateEvent.
    await deps.updateTask({ id: command.taskId, body: { status: 'completed' } }).unwrap();
    return;
  }

  if (command.kind === 'cancel') {
    await deps.updateTask({ id: command.taskId, body: { status: 'canceled' } }).unwrap();
    return;
  }

  if (command.kind === 'delete') {
    await deps.deleteTask(command.taskId).unwrap();
    return;
  }

  if (command.kind === 'update') {
    const patch = command.patch;
    const body: UpdateTaskDTO = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.description !== undefined) body.description = patch.description ?? undefined;
    if (patch.eventType !== undefined) body.eventType = patch.eventType;
    if (patch.estimatedTimeInMinutes !== undefined) {
      body.estimatedTimeInMinutes = patch.estimatedTimeInMinutes;
    }
    if (patch.isRecurring !== undefined) body.isRecurring = patch.isRecurring;
    if (patch.recurrencePattern !== undefined) {
      body.recurrencePattern = patch.recurrencePattern ?? undefined;
    }
    if (patch.recurrenceWeekDays !== undefined) {
      body.recurrenceWeekDays = patch.recurrenceWeekDays;
    }
    if (patch.allowSplit !== undefined) body.allowSplit = patch.allowSplit;
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.deadline !== undefined) body.deadline = patch.deadline;
    if (patch.earliestStartTime !== undefined) body.earliestStartTime = patch.earliestStartTime;
    if (patch.eligibleWeekDays !== undefined) body.eligibleWeekDays = patch.eligibleWeekDays;
    if (patch.scheduledStartTime !== undefined) {
      body.scheduledStartTime = patch.scheduledStartTime;
    }
    if (patch.scheduledEndTime !== undefined) body.scheduledEndTime = patch.scheduledEndTime;
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.googleColorId !== undefined) body.googleColorId = patch.googleColorId;
    if (patch.googleVisibility !== undefined) body.googleVisibility = patch.googleVisibility;
    if (patch.googleTransparency !== undefined) {
      body.googleTransparency = patch.googleTransparency;
    }
    if (patch.googleReminders !== undefined) body.googleReminders = patch.googleReminders;
    if (patch.phaseId !== undefined) {
      body.phaseId = patch.phaseId ?? undefined;
      body.phaseIds = patch.phaseId ? [patch.phaseId] : [];
    }
    await deps.updateTask({ id: command.taskId, body }).unwrap();
    return;
  }

  if (command.kind === 'skip') {
    await deps
      .skipOccurrence({
        id: command.taskId,
        body: {
          occurrenceStart: command.occurrenceStart,
          googleEventId: command.googleEventId ?? undefined,
          googleEventCalendarId: command.googleEventCalendarId ?? undefined,
        },
      })
      .unwrap();
    return;
  }

  if (command.kind === 'move') {
    let progress: TaskMutationProgressHandle | null = null;
    try {
      const moved = await ScheduleApi.moveDisplayedEvent(
        {
          googleEventId: command.googleEventId,
          calendarId: command.calendarId ?? undefined,
          recurringEventId: command.recurringEventId ?? undefined,
          originalStart: command.originalStart,
          originalEnd: command.originalEnd,
          start: command.start,
          end: command.end,
        },
        {
          onMutationStart: () => {
            progress = startTaskMutationProgress({
              taskKey: command.googleEventId || command.taskId,
              title: command.taskName,
              relatedKeys: [
                command.googleEventId,
                command.recurringEventId,
                command.taskId,
              ].filter(Boolean) as string[],
            });
          },
        },
      );
      if (!progress) {
        progress = startTaskMutationProgress({
          taskKey: command.googleEventId || command.taskId,
          title: command.taskName,
        });
      }
      const { recurringMoved } = await settleReplanJob(moved.jobId, (stage) => {
        progress?.setStage(stage);
      });
      refreshCalendar(deps.dispatch);
      progress.finish();
      if (recurringMoved.length && !command.recurringEventId) {
        showSuccessToast({
          title: i18n.t('calendar.recurringRescheduled'),
          detail: recurringMoved.slice(0, 3).join(', '),
        });
      }
    } catch (err) {
      progress?.fail(err instanceof Error ? err.message : undefined);
      throw err;
    }
    return;
  }

  if (command.kind === 'shift') {
    const progress = startTaskMutationProgress({
      taskKey: command.taskId,
      title: command.taskName,
    });
    try {
      await ScheduleApi.rescheduleTask(command.slotId, command.start, command.end);
      progress.setStage('syncing');
      refreshCalendar(deps.dispatch);
      progress.finish();
    } catch (err) {
      progress.fail(err instanceof Error ? err.message : undefined);
      throw err;
    }
    return;
  }

  const body: UpdateTaskDTO = {};
  if (command.earliestStartTime) body.earliestStartTime = command.earliestStartTime;
  if (command.deadline) body.deadline = command.deadline;
  if (command.scheduledStartTime) body.scheduledStartTime = command.scheduledStartTime;
  if (command.scheduledEndTime) body.scheduledEndTime = command.scheduledEndTime;
  if (command.clearUnscheduled) body.isUnscheduled = false;
  await deps.updateTask({ id: command.taskId, body }).unwrap();
}
