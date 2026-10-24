import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import { eventsApi } from './eventsApi';

export type DayReminderPattern = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export type DayReminderDTO = {
  id: string;
  name: string;
  description?: string | null;
  dueYmd: string;
  notificationTime?: string | null;
  recurrencePattern?: DayReminderPattern | null;
  recurrenceWeekDays?: number[] | null;
  recurrenceMonthDay?: number | null;
  googleEventId?: string | null;
  status: 'open' | 'completed';
};

export type WriteDayReminderDTO = {
  name: string;
  description?: string | null;
  dueYmd: string;
  notificationTime?: string | null;
  recurrencePattern?: DayReminderPattern | null;
  recurrenceWeekDays?: number[] | null;
};

async function refreshCalendar(
  dispatch: (action: unknown) => unknown,
  queryFulfilled: Promise<unknown>,
) {
  try {
    await queryFulfilled;
  } finally {
    dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
  }
}

export const dayRemindersApi = createApi({
  reducerPath: 'dayRemindersApi',
  tagTypes: ['DayReminder'],
  baseQuery: customBaseQuery,
  endpoints: (builder) => ({
    getDayReminders: builder.query<DayReminderDTO[], void>({
      query: () => ({ url: '/day-reminders' }),
      providesTags: [{ type: 'DayReminder', id: 'LIST' }],
    }),
    createDayReminder: builder.mutation<DayReminderDTO, WriteDayReminderDTO>({
      query: (data) => ({ url: '/day-reminders', method: 'POST', data }),
      invalidatesTags: [{ type: 'DayReminder', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await refreshCalendar(dispatch, queryFulfilled);
      },
    }),
    updateDayReminder: builder.mutation<
      DayReminderDTO,
      { id: string; body: WriteDayReminderDTO }
    >({
      query: ({ id, body }) => ({ url: `/day-reminders/${id}`, method: 'PATCH', data: body }),
      invalidatesTags: [{ type: 'DayReminder', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await refreshCalendar(dispatch, queryFulfilled);
      },
    }),
    resolveDayReminder: builder.mutation<DayReminderDTO, string>({
      query: (id) => ({ url: `/day-reminders/${id}/resolve`, method: 'POST' }),
      invalidatesTags: [{ type: 'DayReminder', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await refreshCalendar(dispatch, queryFulfilled);
      },
    }),
    deleteDayReminder: builder.mutation<{ deleted: boolean }, string>({
      query: (id) => ({ url: `/day-reminders/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'DayReminder', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await refreshCalendar(dispatch, queryFulfilled);
      },
    }),
  }),
});

export const {
  useGetDayRemindersQuery,
  useCreateDayReminderMutation,
  useUpdateDayReminderMutation,
  useResolveDayReminderMutation,
  useDeleteDayReminderMutation,
} = dayRemindersApi;
