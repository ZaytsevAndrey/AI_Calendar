import { AuthState } from 'modules/auth/slice/authSlice';
import { ForgotPasswordState } from 'modules/auth/reducers/forgotPasswordReducer';
import { ResetPasswordState } from 'modules/auth/reducers/resetPasswordReducer';
import { EmailVerificationState } from 'modules/auth/reducers/emailVerificationReducer';


export type AppDispatch = (...args: unknown[]) => unknown;

export interface RootState {
    auth: AuthState;
    forgotPassword: ForgotPasswordState;
    resetPassword: ResetPasswordState;
    emailVerification: EmailVerificationState;
}