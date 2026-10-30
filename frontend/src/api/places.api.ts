import { createApi } from '@reduxjs/toolkit/query/react';
import { customBaseQuery } from './customBaseQuery';

export type PlaceSuggestionDTO = {
  label: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
};

export const placesApi = createApi({
  reducerPath: 'placesApi',
  baseQuery: customBaseQuery,
  // Same text → same answer for a while; the server caches too.
  keepUnusedDataFor: 300,
  endpoints: (builder) => ({
    searchPlaces: builder.query<PlaceSuggestionDTO[], { q: string; lang?: string }>({
      query: ({ q, lang }) => ({
        url: `/places/search?${new URLSearchParams({ q, lang: lang ?? '' }).toString()}`,
      }),
    }),
  }),
});

export const { useSearchPlacesQuery } = placesApi;
