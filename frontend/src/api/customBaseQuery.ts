import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import apiCall from '../modules/common/utils/apiCall';

export const customBaseQuery: BaseQueryFn<
  { url: string; method?: string; data?: any },
  unknown,
  unknown
> = async ({ url, method = 'GET', data }) => {
  try {
    const response = await apiCall({ url, method, data });
    return { data: response.data };
  } catch (error: any) {
    return { error };
  }
}; 