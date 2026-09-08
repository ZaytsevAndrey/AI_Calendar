import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';
import {
  GoogleCalendarEvent,
  GoogleCalendarEventsResponse,
  CreateEventParams,
  UpdateEventParams,
} from './google-calendar.api';

type EventsCacheDispatch = {
  (
    action: unknown,
  ): { undo: () => void };
};

function patchCachedEventLists(
  dispatch: EventsCacheDispatch,
  getState: () => unknown,
  updater: (events: GoogleCalendarEvent[]) => GoogleCalendarEvent[],
) {
  const argsList = eventsApi.util.selectCachedArgsForQuery(getState() as never, 'getEvents');
  return argsList.map((args) =>
    dispatch(
      eventsApi.util.updateQueryData('getEvents', args, (draft) => {
        if (!Array.isArray(draft?.events)) return;
        draft.events = updater(draft.events);
        draft.totalEvents = draft.events.length;
      }) as never,
    ),
  );
}

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
      async onQueryStarted({ eventId, eventData }, { dispatch, getState, queryFulfilled }) {
        const patches = patchCachedEventLists(dispatch as EventsCacheDispatch, getState, (events) =>
          events.map((event) =>
            event.id === eventId ? { ...event, ...eventData, id: event.id } : event,
          ),
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((patch) => patch.undo());
        }
      },
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
      async onQueryStarted({ eventId }, { dispatch, getState, queryFulfilled }) {
        const patches = patchCachedEventLists(dispatch as EventsCacheDispatch, getState, (events) =>
          events.filter((event) => event.id !== eventId),
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((patch) => patch.undo());
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
} = eventsApi; 