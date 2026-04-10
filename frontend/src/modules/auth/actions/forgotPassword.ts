// api import removed as it's not used
import apiCall from 'modules/common/utils/apiCall';
import createAsyncAction from 'modules/common/utils/createAsyncAction';
import createAction from './index';
import { ForgotPasswordFormData } from 'modules/auth/components/ForgotPasswordForm/types';
import { errorMessages } from 'modules/auth/constants/errorMessages';
import { showSuccessToast, showErrorToast } from '../../../utils/toast';

export const FORGOT_PASSWORD = createAsyncAction(createAction('FORGOT_PASSWORD'));

export const forgotPassword = (data: ForgotPasswordFormData) => async (dispatch: any) => {
    dispatch({ type: FORGOT_PASSWORD.pending });

    try {
        await apiCall({
            method: 'POST',
            url: '/auth/forgot-password',
            data: {
                email: data.email,
            },
        });

        showSuccessToast('Password reset instructions have been sent to your email');
        dispatch({ type: FORGOT_PASSWORD.success });
    } catch (error: any) {
        let errorMessage = 'Failed to send instructions. Please try again.';
        
        if (error?.response?.data) {
            const errorData = error.response.data;
            const errorCode = errorData.code as keyof typeof errorMessages;
            
            if (errorMessages[errorCode]) {
                errorMessage = errorMessages[errorCode];
            } else if (errorData.message) {
                errorMessage = errorData.message;
            }
        }
        
        showErrorToast(errorMessage);
        
        dispatch({
            type: FORGOT_PASSWORD.failure,
            payload: error?.response?.data?.code || 'FORGOT_PASSWORD_ERROR',
        });
    }
};

export default forgotPassword;