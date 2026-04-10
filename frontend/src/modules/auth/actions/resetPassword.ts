// api import removed as it's not used
import apiCall from 'modules/common/utils/apiCall';
import createAsyncAction from 'modules/common/utils/createAsyncAction';
import createAction from './index';
// ResetPasswordFormData import removed as it's not used
import { errorMessages } from 'modules/auth/constants/errorMessages';
import { showSuccessToast, showErrorToast } from '../../../utils/toast';

const RESET_PASSWORD = createAsyncAction(createAction('RESET_PASSWORD'));
export { RESET_PASSWORD };

export const resetPassword = (data: { token: string; newPassword: string }) => async (dispatch: any) => {
    dispatch({ type: RESET_PASSWORD.pending });

    try {
        await apiCall({
            method: 'POST',
            url: '/auth/reset-password',
            data: {
                token: data.token,
                newPassword: data.newPassword,
            },
        });

        showSuccessToast('Password updated. You can log in with your new password.');
        dispatch({ type: RESET_PASSWORD.success });
    } catch (error: any) {
        let errorMessage = 'Failed to change password. Please try again.';
        
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
            type: RESET_PASSWORD.failure,
            payload: error?.response?.data?.code || 'RESET_PASSWORD_ERROR',
        });
    }
};
