import { AuthState } from 'modules/auth/slice/authSlice';

export type AppDispatch = (...args: unknown[]) => unknown;

export interface RootState {
    auth: AuthState;
}
