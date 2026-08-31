import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';

import requestsStatuses from 'modules/common/constants/requestsStatuses';
import { getLoginStatus } from 'modules/auth/selectors/authSelectors';
import { LOGIN } from 'modules/auth/actions/actionTypes';
import apiCall from 'modules/common/utils/apiCall';
import { showErrorToast } from '../../../../utils/toast';

import LoginForm from './LoginForm';

const LoginFormContainer = () => {
    const dispatch = useDispatch<any>();
    const [searchParams] = useSearchParams();
    const loginStatus = useSelector(getLoginStatus);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const err = searchParams.get('error');
        if (err) {
            setErrorMessage('Google sign-in failed. Try again.');
        }
    }, [searchParams]);

    const onGoogleSignIn = async () => {
        dispatch({ type: LOGIN.pending });
        try {
            const response = await apiCall({ method: 'GET', url: '/auth/google' });
            const url = (response?.data as { url?: string } | undefined)?.url;
            if (!url) {
                throw new Error('Missing Google authorization URL');
            }
            window.location.assign(url);
        } catch (error) {
            console.error('Google sign-in start failed:', error);
            showErrorToast('Could not start Google sign-in.');
            dispatch({
                type: LOGIN.failure,
                payload: 'Could not start Google sign-in.',
            });
        }
    };

    return (
        <LoginForm
            onGoogleSignIn={onGoogleSignIn}
            requestStatus={loginStatus}
            errorMessage={errorMessage}
        />
    );
};

export default LoginFormContainer;
