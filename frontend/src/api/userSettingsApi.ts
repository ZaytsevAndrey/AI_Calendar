import { createApi } from '@reduxjs/toolkit/query/react';
import apiCall from '../modules/common/utils/apiCall';
import { UserSettingsDTO, UpdateUserSettingsDTO } from './user-settings.api';

export const userSettingsApi = createApi({
  reducerPath: 'userSettingsApi',
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
    }),
    updateUserSettings: builder.mutation<UserSettingsDTO, UpdateUserSettingsDTO>({
      query: (settings) => ({ url: '/user-settings', method: 'PATCH', data: settings }),
    }),
    checkRequiredSettings: builder.query<{ requiredFilled: boolean }, void>({
      query: () => ({ url: '/user-settings/required' }),
    }),
  }),
});

export const {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
  useCheckRequiredSettingsQuery,
} = userSettingsApi; 