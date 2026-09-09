import { createApi } from '@reduxjs/toolkit/query/react';
import apiCall from '../modules/common/utils/apiCall';
import {
  CreateHabitDTO,
  HabitDTO,
  HabitsListDTO,
  UpdateHabitDTO,
} from './habits.api';

export const habitsApi = createApi({
  reducerPath: 'habitsApi',
  tagTypes: ['Habits'],
  baseQuery: async ({ url, method = 'GET', data }) => {
    try {
      const response = await apiCall({ url, method, data });
      return { data: response.data };
    } catch (error) {
      return { error };
    }
  },
  endpoints: (builder) => ({
    getHabits: builder.query<HabitsListDTO, void>({
      query: () => ({ url: '/habits' }),
      providesTags: [{ type: 'Habits', id: 'LIST' }],
    }),
    createHabit: builder.mutation<HabitDTO, CreateHabitDTO>({
      query: (habit) => ({ url: '/habits', method: 'POST', data: habit }),
      invalidatesTags: [{ type: 'Habits', id: 'LIST' }],
    }),
    updateHabit: builder.mutation<HabitDTO, { id: string; habit: UpdateHabitDTO }>({
      query: ({ id, habit }) => ({ url: `/habits/${id}`, method: 'PATCH', data: habit }),
      invalidatesTags: [{ type: 'Habits', id: 'LIST' }],
    }),
    deleteHabit: builder.mutation<void, string>({
      query: (id) => ({ url: `/habits/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Habits', id: 'LIST' }],
    }),
    checkInHabit: builder.mutation<HabitDTO, { id: string; date: string }>({
      query: ({ id, date }) => ({
        url: `/habits/${id}/check-ins`,
        method: 'POST',
        data: { date },
      }),
      invalidatesTags: [{ type: 'Habits', id: 'LIST' }],
    }),
    uncheckHabit: builder.mutation<HabitDTO, { id: string; date: string }>({
      query: ({ id, date }) => ({
        url: `/habits/${id}/check-ins/${date}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'Habits', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetHabitsQuery,
  useCreateHabitMutation,
  useUpdateHabitMutation,
  useDeleteHabitMutation,
  useCheckInHabitMutation,
  useUncheckHabitMutation,
} = habitsApi;
