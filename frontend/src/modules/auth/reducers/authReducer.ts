import { LOGIN, REGISTER_ASYNC, REFRESH_TOKEN_ASYNC, LOGOUT } from 'modules/auth/actions/actionTypes';


import createReducer from 'modules/common/utils/createReducer';
import requestsStatuses from 'modules/common/constants/requestsStatuses';

export interface AuthState {
    loginStatus: string;
    registerStatus: string;
    refreshStatus: string;
    access_token: string | null;
    refresh_token: string | null;
    error: string | null;
}

const defaultState: AuthState = {
    loginStatus: requestsStatuses.default,
    registerStatus: requestsStatuses.default,
    refreshStatus: requestsStatuses.default,
    access_token: null,
    refresh_token: null,
    error: null,
};

const authReducer = createReducer<AuthState>(defaultState, {
    [LOGIN.pending]: (state) => ({
        ...state,
        loginStatus: requestsStatuses.pending,
        error: null,
    }),

    [LOGIN.success]: (state, action) => ({
        ...state,
        loginStatus: requestsStatuses.success,
        access_token: typeof action.payload === 'object' && action.payload !== null && 'access_token' in action.payload ? (action.payload as any).access_token : null,
        refresh_token: typeof action.payload === 'object' && action.payload !== null && 'refresh_token' in action.payload ? (action.payload as any).refresh_token : null,
        error: null,
    }),

    [LOGIN.failure]: (state, action) => ({
        ...state,
        loginStatus: requestsStatuses.failure,
        error: typeof action.payload === 'string' ? action.payload : String(action.payload) || null,
    }),

    [REGISTER_ASYNC.pending]: (state) => ({
        ...state,
        registerStatus: requestsStatuses.pending,
        error: null,
    }),

    [REGISTER_ASYNC.success]: (state) => ({
        ...state,
        registerStatus: requestsStatuses.success,
        error: null,
    }),

    [REGISTER_ASYNC.failure]: (state, action) => ({
        ...state,
        registerStatus: requestsStatuses.failure,
        error: typeof action.payload === 'string' ? action.payload : String(action.payload) || null,
    }),

    [REFRESH_TOKEN_ASYNC.pending]: (state) => ({
        ...state,
        refreshStatus: requestsStatuses.pending,
        error: null,
    }),

    [REFRESH_TOKEN_ASYNC.success]: (state, action) => ({
        ...state,
        refreshStatus: requestsStatuses.success,
        access_token: typeof action.payload === 'object' && action.payload !== null && 'access_token' in action.payload ? (action.payload as any).access_token : null,
        refresh_token: typeof action.payload === 'object' && action.payload !== null && 'refresh_token' in action.payload ? (action.payload as any).refresh_token : null,
        error: null,
    }),

    [REFRESH_TOKEN_ASYNC.failure]: (state, action) => ({
        ...state,
        refreshStatus: requestsStatuses.failure,
        error: typeof action.payload === 'string' ? action.payload : String(action.payload) || null,
    }),

    [LOGOUT]: () => ({
        ...defaultState,
    }),
});

export default authReducer;
