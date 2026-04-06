import createReducer from 'modules/common/utils/createReducer';
import requestsStatuses from 'modules/common/constants/requestsStatuses';
import { RESET_PASSWORD } from '../actions/resetPassword';

export interface ResetPasswordState {
    requestStatus: string;
    error: string | null;
}

const defaultState: ResetPasswordState = {
    requestStatus: requestsStatuses.default,
    error: null,
};

const resetPasswordReducer = createReducer<ResetPasswordState>(defaultState, {
    [RESET_PASSWORD.pending]: (state) => ({
        ...state,
        requestStatus: requestsStatuses.pending,
        error: null,
    }),

    [RESET_PASSWORD.success]: (state) => ({
        ...state,
        requestStatus: requestsStatuses.success,
        error: null,
    }),

    [RESET_PASSWORD.failure]: (state, action) => ({
        ...state,
        requestStatus: requestsStatuses.failure,
        error: typeof action.payload === 'string' ? action.payload : String(action.payload) || null,
    }),
});

export default resetPasswordReducer;
