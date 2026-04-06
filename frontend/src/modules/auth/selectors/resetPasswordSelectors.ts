import { RootState } from 'store/types';

export const getResetPasswordStatus = (state: RootState) =>
    state.resetPassword.requestStatus;
