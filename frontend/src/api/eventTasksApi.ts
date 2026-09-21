import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import { TaskDTO, CreateTaskDTO, UpdateTaskDTO } from './tasks.api';
import { eventsApi } from './eventsApi';
import { waitForScheduleJob } from './schedule.api';

async function refreshAfterSilentReplan(
  dispatch: (action: unknown) => unknown,
  jobId?: string | null,
) {
  dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
  if (!jobId) return;
  try {
    await waitForScheduleJob(jobId);
  } catch {
    /* still refresh; the task itself already saved */
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
    createEvent: builder.mutation<TaskDTO, CreateTaskDTO>({
      query: (body) => ({ url: '/tasks', method: 'POST', data: body }),
      invalidatesTags: [{ type: 'EventTask', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await refreshAfterSilentReplan(dispatch, data.jobId);
        } catch {
          return;
        }
      },
    }),
    updateEvent: builder.mutation<TaskDTO, { id: string; body: UpdateTaskDTO }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await refreshAfterSilentReplan(dispatch, data.jobId);
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
  }),
});

export const {
  useGetEventsQuery,
  useGetEventQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
} = eventTasksApi;
