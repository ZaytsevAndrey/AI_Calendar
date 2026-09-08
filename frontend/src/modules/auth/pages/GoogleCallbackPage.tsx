import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Spinner } from '../../../ui/Spinner';
import apiCall from '../../common/utils/apiCall';
import { LOGIN } from '../actions/actionTypes';
import { setLocalStorageItem } from '../../../utils/localStorage';
import { UserSettingsApi } from '../../../api/user-settings.api';
import { showErrorToast } from '../../../utils/toast';

const GoogleCallbackPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        const ticket = searchParams.get('ticket');
        if (!ticket) {
            showErrorToast({
                title: 'Sign-in failed',
                detail: 'Google sign-in did not complete.',
            });
            navigate('/login', { replace: true });
            return;
        }

        const finish = async () => {
            try {
                const response = await apiCall({
                    method: 'POST',
                    url: '/auth/google/session',
                    data: { ticket },
                });
                const data = response?.data as {
                    access_token: string;
                    refresh_token: string;
                };
                setLocalStorageItem('access_token', data.access_token);
                setLocalStorageItem('refresh_token', data.refresh_token);
                dispatch({
                    type: LOGIN.success,
                    payload: data,
                });

                try {
                    const settings = await UserSettingsApi.checkRequiredSettings();
                    if (!settings.requiredFilled) {
                        navigate('/settings', { replace: true });
                        return;
                    }
                    if (!settings.hasPhases) {
                        navigate('/setup/phases', { replace: true });
                        return;
                    }
                } catch {
                    navigate('/', { replace: true });
                    return;
                }
                navigate('/', { replace: true });
            } catch (error) {
                console.error('Google sign-in ticket exchange failed:', error);
                showErrorToast({
                    title: 'Sign-in failed',
                    detail: 'Google sign-in failed. Try again.',
                });
                navigate('/login', { replace: true });
            }
        };

        void finish();
    }, [dispatch, navigate, searchParams]);

    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ide-bg text-ide-text">
            <Spinner className="h-10 w-10" />
            <p className="text-lg font-medium text-ide-text">Signing you in…</p>
        </div>
    );
};

export default GoogleCallbackPage;
