import createReducer from 'modules/common/utils/createReducer';
import requestsStatuses from 'modules/common/constants/requestsStatuses';
import { SEND_VERIFICATION_CODE } from 'modules/auth/actions/sendVerificationCode';

export interface EmailVerificationState {
    status: string;
    error: string | null;
}

const defaultState: EmailVerificationState = {
    status: requestsStatuses.default,
    error: null,
};

const emailVerificationReducer = createReducer<EmailVerificationState>(defaultState, {
    [SEND_VERIFICATION_CODE.pending]: (state) => ({
        ...state,
        status: requestsStatuses.pending,
        error: null,
    }),

    [SEND_VERIFICATION_CODE.success]: (state) => ({
        ...state,
        status: requestsStatuses.success,
        error: null,
    }),

    [SEND_VERIFICATION_CODE.failure]: (state, action) => ({
        ...state,
        status: requestsStatuses.failure,
        error: typeof action.payload === 'string' ? action.payload : String(action.payload) || null,
    }),
});

export default emailVerificationReducer;
