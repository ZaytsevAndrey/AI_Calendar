import { RootState } from 'store/types';

export const getEmailVerificationStatus = (state: RootState) =>
    state.emailVerification.status;
