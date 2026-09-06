import { RootState } from 'store/types';

export const getLoginStatus = (state: RootState): string =>
    state.auth.loginStatus;
