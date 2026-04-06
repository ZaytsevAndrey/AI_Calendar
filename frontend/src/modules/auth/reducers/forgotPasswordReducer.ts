import createReducer from 'modules/common/utils/createReducer';
import { FORGOT_PASSWORD } from 'modules/auth/actions/forgotPassword';
import requestsStatuses from 'modules/common/constants/requestsStatuses';

export type ForgotPasswordState = {
    requestStatus: string;
    error: string | null;
};

const initialState: ForgotPasswordState = {
    requestStatus: requestsStatuses.default,
    error: null,
};

export default createReducer(initialState, {
    [FORGOT_PASSWORD.pending]: (state) => ({
        ...state,
        requestStatus: requestsStatuses.pending,
        error: null,
    }),
    [FORGOT_PASSWORD.success]: (state) => ({
        ...state,
        requestStatus: requestsStatuses.success,
        error: null,
    }),
    [FORGOT_PASSWORD.failure]: (state, action) => ({
        ...state,
        requestStatus: requestsStatuses.failure,
        error: typeof action.payload === 'string' ? action.payload : String(action.payload) || null,
    }),
});
