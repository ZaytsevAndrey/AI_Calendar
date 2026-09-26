import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import i18n from 'i18n';

import { getLoginStatus } from 'modules/auth/selectors/authSelectors';
import { LOGIN } from 'modules/auth/actions/actionTypes';
import apiCall from 'modules/common/utils/apiCall';
import { showErrorToast } from '../../../../utils/toast';

import LoginForm from './LoginForm';

const LoginFormContainer = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch<any>();
    const [searchParams] = useSearchParams();
    const loginStatus = useSelector(getLoginStatus);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const err = searchParams.get('error');
        if (err) {
            setErrorMessage(t('auth.googleFailed'));
        }
    }, [searchParams, t]);

    const onGoogleSignIn = async () => {
        dispatch({ type: LOGIN.pending });
        try {
            const response = await apiCall({ method: 'GET', url: '/auth/google' });
            const url = (response?.data as { url?: string } | undefined)?.url;
            if (!url) {
                throw new Error(i18n.t('auth.missingAuthUrl'));
            }
            window.location.assign(url);
        } catch (error) {
            console.error('Google sign-in start failed:', error);
            showErrorToast({
                title: t('auth.signInFailed'),
                detail: t('auth.couldNotStart'),
            });
            dispatch({
                type: LOGIN.failure,
                payload: t('auth.couldNotStart'),
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
