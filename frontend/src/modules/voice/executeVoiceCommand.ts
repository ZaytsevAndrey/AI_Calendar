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
import { showSuccessToast } from 'utils/toast';

type Mutation<T> = (arg: T) => { unwrap: () => Promise<unknown> };

type ExecuteDeps = {
  updateTask: Mutation<{ id: string; body: UpdateTaskDTO }>;
  skipOccurrence: Mutation<{ id: string; body: SkipOccurrenceDTO }>;
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

  if (command.kind === 'complete') {
    await deps.updateTask({ id: command.taskId, body: { status: 'completed' } }).unwrap();
    showSuccessToast({ title: i18n.t('voice.taskCompleted'), detail: command.taskName });
    return;
  }

  if (command.kind === 'cancel') {
    await deps.updateTask({ id: command.taskId, body: { status: 'canceled' } }).unwrap();
    showSuccessToast({ title: i18n.t('voice.taskCanceled'), detail: command.taskName });
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
    showSuccessToast({ title: i18n.t('voice.occurrenceSkipped'), detail: command.taskName });
    return;
  }

  if (command.kind === 'move') {
    const moved = await ScheduleApi.moveDisplayedEvent({
      googleEventId: command.googleEventId,
      calendarId: command.calendarId ?? undefined,
      recurringEventId: command.recurringEventId ?? undefined,
      originalStart: command.originalStart,
      originalEnd: command.originalEnd,
      start: command.start,
      end: command.end,
    });
    const { recurringMoved } = await settleReplanJob(moved.jobId);
    refreshCalendar(deps.dispatch);
    if (command.recurringEventId) {
      showSuccessToast({
        title: i18n.t('calendar.recurringInstanceMoved'),
        detail: command.taskName,
      });
    } else {
      showSuccessToast({ title: i18n.t('voice.eventMoved'), detail: command.taskName });
    }
    if (recurringMoved.length && !command.recurringEventId) {
      showSuccessToast({
        title: i18n.t('calendar.recurringRescheduled'),
        detail: recurringMoved.slice(0, 3).join(', '),
      });
    }
    return;
  }

  if (command.kind === 'shift') {
    await ScheduleApi.rescheduleTask(command.slotId, command.start, command.end);
    refreshCalendar(deps.dispatch);
    showSuccessToast({ title: i18n.t('voice.eventMoved'), detail: command.taskName });
    return;
  }

  const body: UpdateTaskDTO = {};
  if (command.earliestStartTime) body.earliestStartTime = command.earliestStartTime;
  if (command.deadline) body.deadline = command.deadline;
  if (command.scheduledStartTime) body.scheduledStartTime = command.scheduledStartTime;
  if (command.scheduledEndTime) body.scheduledEndTime = command.scheduledEndTime;
  if (command.clearUnscheduled) body.isUnscheduled = false;
  await deps.updateTask({ id: command.taskId, body }).unwrap();
  showSuccessToast({ title: i18n.t('voice.taskRescheduled'), detail: command.taskName });
}
