import apiCall from 'modules/common/utils/apiCall';
import { RegisterFormData } from 'modules/auth/components/RegisterForm/types';
import { errorMessages } from 'modules/auth/constants/errorMessages';
import { REGISTER_ASYNC } from './actionTypes';
import { showSuccessToast, showErrorToast } from '../../../utils/toast';

export const registerUser = (data: RegisterFormData) => async (dispatch: any) => {
    dispatch({ type: REGISTER_ASYNC.pending });

    try {
        await apiCall({
            method: 'post',
            url: '/auth/register',
            data: {
                email: data.email,
                password: data.password,
                confirmPassword: data.confirmPassword,
            },
        });

        showSuccessToast('Registration successful. You can log in now.');
        dispatch({ type: REGISTER_ASYNC.success });
    } catch (error: any) {
        let errorMessage = 'Registration failed. Please try again.';
        
        if (error?.response?.data) {
            const errorData = error.response.data;
            const errorCode = errorData.code as keyof typeof errorMessages;
            
            if (errorMessages[errorCode]) {
                errorMessage = errorMessages[errorCode];
            } else if (errorData.message) {
                errorMessage = errorData.message;
            } else if (errorData.fields) {
                // Build message from field errors
                const fieldErrors = Object.values(errorData.fields);
                if (fieldErrors.length > 0) {
                    errorMessage = fieldErrors.join('. ');
                }
            }
        }
        
        showErrorToast(errorMessage);
        
        dispatch({
            type: REGISTER_ASYNC.failure,
            payload: error?.response?.data?.code || 'REGISTRATION_ERROR',
        });
    }
};
