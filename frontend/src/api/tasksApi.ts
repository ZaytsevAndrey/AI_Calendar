import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import { TaskDTO, CreateTaskDTO, UpdateTaskDTO } from './tasks.api';

export const tasksApi = createApi({
  reducerPath: 'tasksApi',
  baseQuery: customBaseQuery,
  endpoints: (builder) => ({
    getTasks: builder.query<TaskDTO[], void>({
      query: () => ({ url: '/tasks' }),
    }),
    getTask: builder.query<TaskDTO, string>({
      query: (id) => ({ url: `/tasks/${id}` }),
    }),
    createTask: builder.mutation<TaskDTO, CreateTaskDTO>({
      query: (body) => ({ url: '/tasks', method: 'POST', data: body }),
    }),
    updateTask: builder.mutation<TaskDTO, { id: string; body: UpdateTaskDTO }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PATCH', data: body }),
    }),
    deleteTask: builder.mutation<void, string>({
      query: (id) => ({ url: `/tasks/${id}`, method: 'DELETE' }),
    }),
  }),
});

export const {
  useGetTasksQuery,
  useGetTaskQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} = tasksApi; 