import apiCall from 'modules/common/utils/apiCall';
import { Dispatch } from 'redux';

import { errorMessages } from 'modules/auth/constants/errorMessages';
import { INVALID_CREDENTIALS } from 'modules/auth/constants/errorCodes';
import { LOGIN } from './actionTypes';
import { showErrorToast } from '../../../utils/toast';
import { setLocalStorageItem } from '../../../utils/localStorage';

export const loginUser = (formData: { email: string; password: string }) => {
    return async (dispatch: Dispatch) => {
        dispatch({ type: LOGIN.pending });

        try {
            const response = await apiCall({
                method: 'POST',
                url: '/auth/login',
                data: {
                    username: formData.email,
                    password: formData.password,
                },
            });

            if (!response) throw new Error('No response from server');
            const { access_token, refresh_token } = response.data as { access_token: string, refresh_token: string };

            setLocalStorageItem('access_token', access_token);
            setLocalStorageItem('refresh_token', refresh_token);

            dispatch({
                type: LOGIN.success,
                payload: { access_token, refresh_token },
            });
        } catch (error: any) {
            let errorMessage = 'Sign-in failed. Check your credentials and try again.';
            
            // Log the full error for debugging
            console.error('Login error:', error);
            
            // Check for different error formats
            if (error && error.response && error.response.data) {
                const errorData = error.response.data;
                
                // First priority: Use the reconstructed error code from the interceptor
                if (errorData.code) {
                    const errorKey = errorData.code as keyof typeof errorMessages;
                    if (errorMessages[errorKey]) {
                        errorMessage = errorMessages[errorKey];
                    }
                }
                // Second priority: Check for field errors that might contain validation messages
                else if (errorData.fields) {
                    if (errorData.fields.username) {
                        errorMessage = errorData.fields.username;
                    }
                }
                // Third priority: Check for a 500 error that contains INVALID_CREDENTIALS in the error string
                else if (errorData.statusCode === 500 && error.toString().includes('INVALID_CREDENTIALS')) {
                    errorMessage = errorMessages[INVALID_CREDENTIALS];
                }
                // Final fallback: Use the message if available
                else if (errorData.message && errorData.message !== 'Internal server error') {
                    errorMessage = errorData.message;
                }
            }
            
            // Surface error as toast
            showErrorToast(errorMessage);
            
            dispatch({
                type: LOGIN.failure,
                payload: errorMessage,
            });
        }
    };
};
