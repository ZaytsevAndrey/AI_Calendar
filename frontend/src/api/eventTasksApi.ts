import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import { TaskDTO, CreateTaskDTO, UpdateTaskDTO, SkipOccurrenceDTO } from './tasks.api';
import { eventsApi } from './eventsApi';
import { emitScheduleConflicts } from 'modules/schedule/conflictChoiceBus';
import { settleReplanJob } from 'modules/schedule/settleReplanJob';

type TaskWriteResult = TaskDTO & {
  jobId?: string | null;
  conflicts?: Array<{
    taskId: string;
    taskName: string;
    reason: 'preferred_on_fixed' | 'phase_full';
    options: Array<'move_other' | 'move_new' | 'skip_occurrence' | 'leave_problematic'>;
    meta?: Record<string, unknown>;
  }>;
};

async function refreshAfterSilentReplan(
  dispatch: (action: unknown) => unknown,
  result: TaskWriteResult,
) {
  dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
  if (result.conflicts?.length) {
    emitScheduleConflicts(result.conflicts);
  } else {
    await settleReplanJob(result.jobId);
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
    createEvent: builder.mutation<TaskWriteResult, CreateTaskDTO>({
      query: (body) => ({ url: '/tasks', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'EventTask', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await refreshAfterSilentReplan(dispatch, data);
        } catch {
          return;
        }
      },
    }),
    updateEvent: builder.mutation<TaskWriteResult, { id: string; body: UpdateTaskDTO }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await refreshAfterSilentReplan(dispatch, data);
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
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) =>
            draft.filter((task) => task.id !== id),
          ),
        );
        try {
          await queryFulfilled;
          dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
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
        const eventId = body.googleEventId;
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
            const task = draft.find((item) => item.id === id);
            if (!task || task.isRecurring) return;
            task.scheduledStartTime = undefined;
            task.scheduledEndTime = undefined;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(
            eventTasksApi.util.updateQueryData('getEvents', undefined, (draft) => {
              const index = draft.findIndex((item) => item.id === id);
              if (index < 0) return;
              draft[index] = { ...draft[index], ...data };
              if (!draft[index].isRecurring) {
                draft[index].scheduledStartTime = undefined;
                draft[index].scheduledEndTime = undefined;
              }
            }),
          );
          dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
        } catch {
          taskPatch.undo();
          eventPatches.forEach((patch) => patch.undo());
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
} = eventTasksApi;
