import { LOGOUT } from './actionTypes';
import apiCall from 'modules/common/utils/apiCall';
import { showSuccessToast } from '../../../utils/toast';
import { removeLocalStorageItem } from '../../../utils/localStorage';

export const logout = (redirect = false) => async (dispatch: any) => {
    try {
        await apiCall({
            method: 'POST',
            url: '/auth/logout',
        });
    } catch (error) {
        console.log(error);
    } finally {
        removeLocalStorageItem('access_token');
        removeLocalStorageItem('refresh_token');

        showSuccessToast('Ви успішно вийшли з системи');
        dispatch({ type: LOGOUT });

        if (redirect) {
            window.location.href = '/login';
        }
    }
};

// Додатковий клієнтський логаут без запиту на бекенд
export const clientLogout = (redirect = false) => (dispatch: any) => {
    console.log('clientLogout called with redirect:', redirect);
    removeLocalStorageItem('access_token');
    removeLocalStorageItem('refresh_token');
    showSuccessToast('Ви успішно вийшли з системи');
    dispatch({ type: LOGOUT });
    if (redirect) {
        console.log('Redirecting to login page');
        window.location.replace('/login');
    }
};
