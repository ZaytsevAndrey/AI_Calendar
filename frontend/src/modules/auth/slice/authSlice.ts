import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { LOGIN, LOGOUT, REFRESH_TOKEN_ASYNC } from '../actions/actionTypes';

export interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  loginStatus: string;
  error: string | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  accessToken: null,
  refreshToken: null,
  loginStatus: 'idle',
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(LOGIN.pending, (state) => {
        state.loginStatus = 'pending';
        state.error = null;
      })
      .addCase(LOGIN.success, (state, action: PayloadAction<{ access_token: string; refresh_token: string }>) => {
        state.isAuthenticated = true;
        state.accessToken = action.payload.access_token;
        state.refreshToken = action.payload.refresh_token;
        state.loginStatus = 'success';
        state.error = null;
      })
      .addCase(LOGIN.failure, (state, action: PayloadAction<string>) => {
        state.isAuthenticated = false;
        state.accessToken = null;
        state.refreshToken = null;
        state.loginStatus = 'failure';
        state.error = action.payload;
      })
      .addCase(REFRESH_TOKEN_ASYNC.success, (state, action: PayloadAction<{ access_token: string; refresh_token: string }>) => {
        state.isAuthenticated = true;
        state.accessToken = action.payload.access_token;
        state.refreshToken = action.payload.refresh_token;
      })
      .addCase(LOGOUT, () => ({ ...initialState }));
  },
});

export default authSlice.reducer;
