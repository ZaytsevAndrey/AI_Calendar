import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import { TaskDTO, CreateTaskDTO, UpdateTaskDTO } from './tasks.api';

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
    }),
    updateEvent: builder.mutation<TaskDTO, { id: string; body: UpdateTaskDTO }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
    }),
    deleteEvent: builder.mutation<void, string>({
      query: (id) => ({ url: `/tasks/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'EventTask', id: 'LIST' },
        { type: 'EventTask', id },
      ],
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
