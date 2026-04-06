import { createApi } from '@reduxjs/toolkit/query/react';
import apiCall from '../modules/common/utils/apiCall';
import { PhaseDTO, CreatePhaseDTO, UpdatePhaseDTO } from './phases.api';

export const phasesApi = createApi({
  reducerPath: 'phasesApi',
  tagTypes: ['Phases'],
  baseQuery: async ({ url, method = 'GET', data }) => {
    try {
      const response = await apiCall({ url, method, data });
      return { data: response.data };
    } catch (error) {
      return { error };
    }
  },
  endpoints: (builder) => ({
    getAllPhases: builder.query<PhaseDTO[], void>({
      query: () => ({ url: '/phases' }),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Phases' as const, id })),
              { type: 'Phases', id: 'LIST' },
            ]
          : [{ type: 'Phases', id: 'LIST' }],
    }),
    getPhase: builder.query<PhaseDTO, string>({
      query: (id) => ({ url: `/phases/${id}` }),
    }),
    createPhase: builder.mutation<PhaseDTO, CreatePhaseDTO>({
      query: (phase) => ({ url: '/phases', method: 'POST', data: phase }),
      invalidatesTags: [{ type: 'Phases', id: 'LIST' }],
    }),
    updatePhase: builder.mutation<PhaseDTO, { id: string; phase: UpdatePhaseDTO }>({
      query: ({ id, phase }) => ({ url: `/phases/${id}`, method: 'PATCH', data: phase }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Phases', id },
        { type: 'Phases', id: 'LIST' },
      ],
    }),
    deletePhase: builder.mutation<void, string>({
      query: (id) => ({ url: `/phases/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Phases', id },
        { type: 'Phases', id: 'LIST' },
      ],
    }),
    getTimePhases: builder.query<PhaseDTO[], void>({
      query: () => ({ url: '/phases/time-phases' }),
    }),
    getTimePhasesForDate: builder.query<PhaseDTO[], string>({
      query: (date) => ({ url: `/phases/time-phases/date/${date}` }),
    }),
    getSleepTimePhases: builder.query<PhaseDTO[], void>({
      query: () => ({ url: '/phases/sleep-time' }),
    }),
  }),
});

export const {
  useGetAllPhasesQuery,
  useGetPhaseQuery,
  useCreatePhaseMutation,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
  useGetTimePhasesQuery,
  useGetTimePhasesForDateQuery,
  useGetSleepTimePhasesQuery,
} = phasesApi; 