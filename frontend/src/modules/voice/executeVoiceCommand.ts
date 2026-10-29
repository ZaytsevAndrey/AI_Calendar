import { dayRemindersApi } from 'api/dayReminders.api';
import { eventsApi } from 'api/eventsApi';
import { eventTasksApi } from 'api/eventTasksApi';
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

export async function executeVoiceCommand(
  command: VoiceCommandAction,
  deps: ExecuteDeps,
): Promise<void> {
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

  if (command.kind === 'delete_event') {
    // RTK returns the mutation promise from dispatch; the deps type only says void.
    const request = deps.dispatch(
      eventsApi.endpoints.deleteEvent.initiate({
        eventId: command.eventId,
        calendarId: command.calendarId ?? undefined,
        provider: command.provider,
      }),
    ) as unknown as { unwrap: () => Promise<unknown> };
    await request.unwrap();
    refreshCalendar(deps.dispatch);
    return;
  }

  if (command.kind === 'rename_event') {
    const request = deps.dispatch(
      eventsApi.endpoints.updateEvent.initiate({
        eventId: command.eventId,
        eventData: { summary: command.title },
        calendarId: command.calendarId ?? undefined,
        provider: command.provider,
      }),
    ) as unknown as { unwrap: () => Promise<unknown> };
    await request.unwrap();
    refreshCalendar(deps.dispatch);
    return;
  }

  if (
    command.kind === 'remind_create' ||
    command.kind === 'remind_update' ||
    command.kind === 'remind_resolve' ||
    command.kind === 'remind_delete'
  ) {
    await runReminderCommand(command, deps.dispatch);
    return;
  }

  if (command.kind === 'end_series') {
    await apiCall({
      url: `/tasks/${command.taskId}/end-series-from`,
      method: 'POST',
      data: {
        occurrenceStart: command.occurrenceStart,
        googleEventId: command.googleEventId ?? undefined,
        googleEventCalendarId: command.googleEventCalendarId ?? undefined,
      },
    });
    refreshCalendar(deps.dispatch);
    deps.dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
    showSuccessToast({
      title: i18n.t('calendar.seriesEndedFrom'),
      detail: command.taskName,
    });
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
          ...(command.provider ? { provider: command.provider } : {}),
          recurringEventId: command.recurringEventId ?? undefined,
          originalStart: command.originalStart,
          originalEnd: command.originalEnd,
          start: command.start,
          end: command.end,
          seriesScope: command.seriesScope,
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

async function runReminderCommand(
  command: Extract<
    VoiceCommandAction,
    { kind: 'remind_create' | 'remind_update' | 'remind_resolve' | 'remind_delete' }
  >,
  dispatch: (action: any) => void,
): Promise<void> {
  const body = {
    name: 'name' in command ? command.name : '',
    dueYmd: 'dueYmd' in command ? command.dueYmd : '',
    notificationTime: 'notificationTime' in command ? command.notificationTime : null,
    description: 'description' in command ? command.description : null,
    recurrencePattern: 'recurrencePattern' in command ? command.recurrencePattern : null,
    recurrenceWeekDays: 'recurrenceWeekDays' in command ? command.recurrenceWeekDays : null,
  };
  if (command.kind === 'remind_create') {
    await apiCall({ url: '/day-reminders', method: 'POST', data: body });
  } else if (command.kind === 'remind_update') {
    await apiCall({ url: `/day-reminders/${command.reminderId}`, method: 'PATCH', data: body });
  } else if (command.kind === 'remind_resolve') {
    await apiCall({ url: `/day-reminders/${command.reminderId}/resolve`, method: 'POST' });
  } else {
    await apiCall({ url: `/day-reminders/${command.reminderId}`, method: 'DELETE' });
  }
  dispatch(dayRemindersApi.util.invalidateTags([{ type: 'DayReminder', id: 'LIST' }]));
  refreshCalendar(dispatch);
}
