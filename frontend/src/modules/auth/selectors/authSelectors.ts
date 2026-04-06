import { RootState } from 'store/types';

export const getAccessToken = (state: RootState): string | null =>
    state.auth.accessToken;

export const getRefreshToken = (state: RootState): string | null =>
    state.auth.refreshToken;

export const getLoginStatus = (state: RootState): string =>
    state.auth.loginStatus;

export const getAuthError = (state: RootState): string | null =>
    state.auth.error;

export const isAuthenticated = (state: RootState): boolean =>
    state.auth.isAuthenticated;

export const getRegisterStatus = (state: RootState) => state.auth.registerStatus;
