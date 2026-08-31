import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import {
  GoogleCalendarEvent,
  GoogleCalendarEventsResponse,
  CreateEventParams,
  UpdateEventParams,
} from './google-calendar.api';

export const eventsApi = createApi({
  reducerPath: 'eventsApi',
  baseQuery: customBaseQuery,
  tagTypes: ['Event'],
  endpoints: (builder) => ({
    getEvents: builder.query<GoogleCalendarEventsResponse, any>({
      query: (params) => {
        const searchParams = new URLSearchParams();
        if (params?.timeMin) searchParams.append('timeMin', params.timeMin);
        if (params?.timeMax) searchParams.append('timeMax', params.timeMax);
        if (params?.calendarId) searchParams.append('calendarId', params.calendarId);
        // add other params if needed
        return { url: `/google-calendar/events?${searchParams.toString()}`, method: 'GET' };
      },
      providesTags: (result) =>
        result?.events
          ? [
              ...result.events.map((event) => ({ type: 'Event' as const, id: event.id })),
              { type: 'Event', id: 'LIST' },
            ]
          : [{ type: 'Event', id: 'LIST' }],
    }),
    getEvent: builder.query<GoogleCalendarEvent, { eventId: string; calendarId?: string }>({
      query: ({ eventId, calendarId }) => ({
        url:
          calendarId != null && calendarId !== ''
            ? `/google-calendar/events/${eventId}?calendarId=${encodeURIComponent(calendarId)}`
            : `/google-calendar/events/${eventId}`,
        method: 'GET',
      }),
      providesTags: (result, error, { eventId }) => [{ type: 'Event', id: eventId }],
    }),
    createEvent: builder.mutation<GoogleCalendarEvent, { eventData: CreateEventParams; calendarId?: string }>({
      query: ({ eventData, calendarId }) => ({
        url:
          calendarId != null && calendarId !== ''
            ? `/google-calendar/events?calendarId=${encodeURIComponent(calendarId)}`
            : `/google-calendar/events`,
        method: 'POST',
        data: eventData,
      }),
      invalidatesTags: [{ type: 'Event', id: 'LIST' }],
    }),
    updateEvent: builder.mutation<GoogleCalendarEvent, { eventId: string; eventData: UpdateEventParams; calendarId?: string }>({
      query: ({ eventId, eventData, calendarId }) => ({
        url:
          calendarId != null && calendarId !== ''
            ? `/google-calendar/events/${eventId}?calendarId=${encodeURIComponent(calendarId)}`
            : `/google-calendar/events/${eventId}`,
        method: 'PUT',
        data: eventData,
      }),
      invalidatesTags: (result, error, { eventId }) => [
        { type: 'Event', id: eventId },
        { type: 'Event', id: 'LIST' },
      ],
    }),
    deleteEvent: builder.mutation<void, { eventId: string; calendarId?: string }>({
      query: ({ eventId, calendarId }) => ({
        url:
          calendarId != null && calendarId !== ''
            ? `/google-calendar/events/${eventId}?calendarId=${encodeURIComponent(calendarId)}`
            : `/google-calendar/events/${eventId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { eventId }) => [
        { type: 'Event', id: eventId },
        { type: 'Event', id: 'LIST' },
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
} = eventsApi; 