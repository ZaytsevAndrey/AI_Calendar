import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import {
  TaskDTO,
  CreateTaskDTO,
  UpdateTaskDTO,
  SkipOccurrenceDTO,
  PlaceProblematicDTO,
  PlaceProblematicResult,
} from './tasks.api';
import { eventsApi } from './eventsApi';
import { emitScheduleConflicts } from 'modules/schedule/conflictChoiceBus';
import { settleReplanJob } from 'modules/schedule/settleReplanJob';
import {
  runTaskMutationProgress,
  type MutationStage,
} from 'modules/schedule/taskMutationProgress';
import i18n from 'i18next';
import { describeStoredTask } from 'modules/voice/summarizeStoredTask';

type TaskWriteResult = TaskDTO & {
  jobId?: string | null;
  conflicts?: Array<{
    taskId: string;
    taskName: string;
    reason: 'preferred_on_fixed' | 'phase_full';
    options: Array<
      | 'move_other'
      | 'move_new'
      | 'skip_occurrence'
      | 'place_on_top'
      | 'leave_problematic'
    >;
    meta?: Record<string, unknown>;
  }>;
};

async function refreshAfterSilentReplan(
  dispatch: (action: unknown) => unknown,
  result: TaskWriteResult,
  onStage?: (stage: MutationStage) => void,
) {
  dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
  if (result.conflicts?.length) {
    emitScheduleConflicts(result.conflicts);
    onStage?.('done');
  } else if (result.jobId) {
    await settleReplanJob(result.jobId, onStage);
  } else {
    onStage?.('syncing');
    await settleReplanJob(null);
  }
  dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
  dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
}

export const eventTasksApi = createApi({
  reducerPath: 'eventTasksApi',
  baseQuery: customBaseQuery,
  tagTypes: ['EventTask'],
  endpoints: (builder) => ({
    getEvents: builder.query<TaskDTO[], void>({
      query: () => ({ url: '/tasks' }),
      providesTags: (result) =>
        result
          ? [
              ...result.map((event) => ({ type: 'EventTask' as const, id: event.id })),
              { type: 'EventTask' as const, id: 'LIST' },
            ]
          : [{ type: 'EventTask' as const, id: 'LIST' }],
    }),
    getEvent: builder.query<TaskDTO, string>({
      query: (id) => ({ url: `/tasks/${id}` }),
      providesTags: (_r, _e, id) => [{ type: 'EventTask' as const, id }],
    }),
    createEvent: builder.mutation<TaskWriteResult, CreateTaskDTO & { idempotencyKey?: string }>({
      // The key names this create operation: a retry of it returns the same task.
      query: ({ idempotencyKey, ...body }) => ({
        url: '/tasks',
        method: 'POST',
        data: body,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      }),
      invalidatesTags: [{ type: 'EventTask', id: 'LIST' }],
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        const tempId = `temp-${Date.now()}`;
        const nowIso = new Date().toISOString();
        const optimistic = {
          id: tempId,
          name: arg.name,
          description: arg.description ?? undefined,
          eventType: arg.eventType ?? 'admin',
          estimatedTimeInMinutes: arg.estimatedTimeInMinutes ?? 30,
          isRecurring: !!arg.isRecurring,
          isUnscheduled: !!arg.isUnscheduled,
          scheduleState: arg.scheduleState ?? 'none',
          status: 'todo' as const,
          priority: (arg.priority ?? 'medium') as TaskDTO['priority'],
          allowSplit: !!arg.allowSplit,
          scheduledStartTime: arg.scheduledStartTime ?? undefined,
          scheduledEndTime: arg.scheduledEndTime ?? undefined,
          deadline: arg.deadline ?? undefined,
          earliestStartTime: arg.earliestStartTime ?? undefined,
          phaseId: arg.phaseId ?? undefined,
          phases: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        } satisfies TaskDTO;
        dispatch(
          eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
            draft.unshift(optimistic);
          }),
        );
        let accepted = false;
        try {
          await runTaskMutationProgress({
            taskKey: tempId,
            title: arg.name,
            run: async (progress) => {
              const { data } = await queryFulfilled;
              accepted = true;
              progress.retarget(data.id);
              dispatch(
                eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
                  const index = draft.findIndex((row) => row.id === tempId);
                  if (index >= 0) draft[index] = data;
                  else draft.unshift(data);
                }),
              );
              await refreshAfterSilentReplan(dispatch, data, (stage) => {
                progress.setStage(stage);
              });
              return data;
            },
            doneDetail: (data) =>
              describeStoredTask(data, {
                timeZone: data.scheduleTimeZone || arg.timeZone,
                nowIso: new Date().toISOString(),
              }) || undefined,
          });
        } catch {
          // AUD-019: never undo by patch — it removes by position, and the
          // list may have been refetched meanwhile (the real task, or another
          // row, would go). Drop only the optimistic row; an accepted create
          // whose job poll failed stays, and the list is refetched.
          dispatch(
            eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
              const index = draft.findIndex((row) => row.id === tempId);
              if (index >= 0) draft.splice(index, 1);
            }),
          );
          if (accepted) {
            dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
          }
        }
      },
    }),
    updateEvent: builder.mutation<TaskWriteResult, { id: string; body: UpdateTaskDTO }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted(arg, { dispatch, queryFulfilled, getState }) {
        const existing = eventTasksApi.endpoints.getEvents
          .select()(getState() as never)
          ?.data?.find((row) => row.id === arg.id);
        const title = existing?.name ?? i18n.t('tasks.thisTask');
        try {
          await runTaskMutationProgress({
            taskKey: arg.id,
            title,
            relatedKeys: existing?.googleEventId ? [existing.googleEventId] : undefined,
            run: async (progress) => {
              const { data } = await queryFulfilled;
              await refreshAfterSilentReplan(dispatch, data, (stage) => {
                progress.setStage(stage);
              });
              return { saved: data, body: arg.body };
            },
            doneDetail: ({ saved, body }) =>
              describeStoredTask(
                { ...body, scheduleState: saved.scheduleState },
                {
                  timeZone: body.timeZone || saved.scheduleTimeZone,
                  nowIso: new Date().toISOString(),
                  rename: true,
                  mentionDefaults: true,
                  mentionClears: true,
                },
              ) || undefined,
          });
        } catch {
          return;
        }
      },
    }),
    deleteEvent: builder.mutation<void, string>({
      query: (id) => ({ url: `/tasks/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted(id, { dispatch, queryFulfilled, getState }) {
        const existing = eventTasksApi.endpoints.getEvents
          .select()(getState() as never)
          ?.data?.find((row) => row.id === id);
        const title = existing?.name ?? i18n.t('tasks.thisTask');
        const patch = dispatch(
          eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
            // Match backend: deleting a series also drops Problematic park copies.
            const next = draft.filter(
              (task) => task.id !== id && task.parentSeriesId !== id,
            );
            draft.splice(0, draft.length, ...next);
          }),
        );
        try {
          await runTaskMutationProgress({
            taskKey: id,
            title,
            relatedKeys: existing?.googleEventId ? [existing.googleEventId] : undefined,
            run: async (progress) => {
              await queryFulfilled;
              progress.setStage('syncing');
              dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            },
          });
        } catch {
          patch.undo();
        }
      },
    }),
    skipOccurrence: builder.mutation<
      TaskDTO,
      { id: string; body: SkipOccurrenceDTO }
    >({
      query: ({ id, body }) => ({
        url: `/tasks/${id}/skip-occurrence`,
        method: 'POST',
        data: body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted({ id, body }, { dispatch, getState, queryFulfilled }) {
        const existing = eventTasksApi.endpoints.getEvents
          .select()(getState() as never)
          ?.data?.find((row) => row.id === id);
        const title = existing?.name ?? i18n.t('tasks.thisTask');
        const eventId = body.googleEventId;
        const deletesParkCopy =
          existing?.scheduleState === 'problematic' && !existing?.isRecurring;
        const eventPatches = eventId
          ? eventsApi.util.selectCachedArgsForQuery(getState() as never, 'getEvents').map((args) =>
              dispatch(
                eventsApi.util.updateQueryData('getEvents', args, (draft) => {
                  if (!Array.isArray(draft?.events)) return;
                  draft.events = draft.events.filter((event) => event.id !== eventId);
                  draft.totalEvents = draft.events.length;
                }),
              ),
            )
          : [];
        const taskPatch = dispatch(
          eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
            if (deletesParkCopy) {
              const next = draft.filter((task) => task.id !== id);
              draft.splice(0, draft.length, ...next);
              return;
            }
            const task = draft.find((item) => item.id === id);
            if (!task) return;
            task.scheduledStartTime = undefined;
            task.scheduledEndTime = undefined;
          }),
        );
        try {
          await runTaskMutationProgress({
            taskKey: id,
            title,
            relatedKeys: eventId ? [eventId] : undefined,
            run: async (progress) => {
              const { data } = await queryFulfilled;
              dispatch(
                eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
                  if (data?.deleted || deletesParkCopy) {
                    const next = draft.filter((task) => task.id !== id);
                    draft.splice(0, draft.length, ...next);
                    return;
                  }
                  const index = draft.findIndex((item) => item.id === id);
                  if (index < 0) {
                    draft.unshift(data);
                    return;
                  }
                  draft[index] = { ...draft[index], ...data };
                }),
              );
              progress.setStage('syncing');
              dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            },
          });
        } catch {
          taskPatch.undo();
          eventPatches.forEach((patch) => patch.undo());
        }
      },
    }),
    /** Problematic Move: seat a parked task (or one parked series day) on a free slot. */
    placeProblematic: builder.mutation<
      PlaceProblematicResult,
      { id: string; body: PlaceProblematicDTO }
    >({
      query: ({ id, body }) => ({
        url: `/schedule/problematic/${id}/place`,
        method: 'POST',
        data: body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted({ id }, { dispatch, queryFulfilled, getState }) {
        const existing = eventTasksApi.endpoints.getEvents
          .select()(getState() as never)
          ?.data?.find((row) => row.id === id);
        const title = existing?.name ?? i18n.t('tasks.thisTask');
        try {
          await runTaskMutationProgress({
            taskKey: id,
            title,
            run: async (progress) => {
              await queryFulfilled;
              progress.setStage('syncing');
              await settleReplanJob(null);
              dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            },
          });
        } catch {
          return;
        }
      },
    }),
    endSeriesFrom: builder.mutation<
      TaskDTO,
      { id: string; body: SkipOccurrenceDTO }
    >({
      query: ({ id, body }) => ({
        url: `/tasks/${id}/end-series-from`,
        method: 'POST',
        data: body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted({ id }, { dispatch, queryFulfilled, getState }) {
        const existing = eventTasksApi.endpoints.getEvents
          .select()(getState() as never)
          ?.data?.find((row) => row.id === id);
        const title = existing?.name ?? i18n.t('tasks.thisTask');
        try {
          await runTaskMutationProgress({
            taskKey: id,
            title,
            relatedKeys: existing?.googleEventId ? [existing.googleEventId] : undefined,
            run: async (progress) => {
              const { data } = await queryFulfilled;
              dispatch(
                eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
                  const index = draft.findIndex((item) => item.id === id);
                  if (index < 0) {
                    draft.unshift(data);
                    return;
                  }
                  draft[index] = { ...draft[index], ...data };
                }),
              );
              progress.setStage('syncing');
              dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            },
          });
        } catch {
          return;
        }
      },
    }),
  }),
});

export const {
  useGetEventsQuery,
  useGetEventQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useSkipOccurrenceMutation,
  usePlaceProblematicMutation,
  useEndSeriesFromMutation,
} = eventTasksApi;
