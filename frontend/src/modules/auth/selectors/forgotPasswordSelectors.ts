import { RootState } from 'store/types';

export const getForgotPasswordStatus = (state: RootState) =>
    state.forgotPassword.requestStatus;
