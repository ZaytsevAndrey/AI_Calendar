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

        showSuccessToast('Реєстрація успішна! Тепер ви можете увійти в систему.');
        dispatch({ type: REGISTER_ASYNC.success });
    } catch (error: any) {
        let errorMessage = 'Помилка при реєстрації. Спробуйте ще раз.';
        
        if (error?.response?.data) {
            const errorData = error.response.data;
            const errorCode = errorData.code as keyof typeof errorMessages;
            
            if (errorMessages[errorCode]) {
                errorMessage = errorMessages[errorCode];
            } else if (errorData.message) {
                errorMessage = errorData.message;
            } else if (errorData.fields) {
                // Формуємо повідомлення з помилок полів
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
