import { createApi } from '@reduxjs/toolkit/query/react';
import apiCall from '../modules/common/utils/apiCall';
import {
  UserSettingsDTO,
  UpdateUserSettingsDTO,
  UserSettingsRequiredDTO,
} from './user-settings.api';

export const userSettingsApi = createApi({
  reducerPath: 'userSettingsApi',
  tagTypes: ['UserSettings', 'UserSettingsRequired'],
  baseQuery: async ({ url, method = 'GET', data }) => {
    try {
      const response = await apiCall({ url, method, data });
      return { data: response.data };
    } catch (error) {
      return { error };
    }
  },
  endpoints: (builder) => ({
    getUserSettings: builder.query<UserSettingsDTO, void>({
      query: () => ({ url: '/user-settings' }),
      providesTags: ['UserSettings'],
    }),
    updateUserSettings: builder.mutation<UserSettingsDTO, UpdateUserSettingsDTO>({
      query: (settings) => ({ url: '/user-settings', method: 'PATCH', data: settings }),
      invalidatesTags: ['UserSettings', 'UserSettingsRequired'],
    }),
    checkRequiredSettings: builder.query<UserSettingsRequiredDTO, void>({
      query: () => ({ url: '/user-settings/required' }),
      providesTags: ['UserSettingsRequired'],
    }),
  }),
});

export const {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
  useCheckRequiredSettingsQuery,
} = userSettingsApi;
