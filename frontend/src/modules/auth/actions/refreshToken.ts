import { Dispatch } from 'redux';

import apiCall from 'modules/common/utils/apiCall';
import { REFRESH_TOKEN_ASYNC } from './actionTypes';

export const refreshToken = () => async (dispatch: Dispatch) => {
    dispatch({ type: REFRESH_TOKEN_ASYNC.pending });

    try {
        const response = await apiCall({
            method: 'POST',
            url: '/auth/refresh',
            data: {
                refresh_token: localStorage.getItem('refresh_token'),
            },
        });

        if (!response) throw new Error('No response from server');
        const data = response.data as { access_token: string, refresh_token: string };
        const { access_token, refresh_token } = data;

        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', refresh_token);

        dispatch({
            type: REFRESH_TOKEN_ASYNC.success,
            payload: { access_token, refresh_token },
        });
    } catch (error: any) {
        let errorMessage = 'Помилка при оновленні токена.';
        if (error && error.response && error.response.data) {
            if (error.response.data.message) {
                errorMessage = error.response.data.message;
            }
        }
        dispatch({
            type: REFRESH_TOKEN_ASYNC.failure,
            payload: errorMessage,
        });
        throw error;
    }
};
