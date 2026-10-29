import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import LoginForm from 'modules/auth/components/LoginForm';
import { LOGOUT } from 'modules/auth/actions/actionTypes';
import { removeLocalStorageItem } from '../../utils/localStorage';
import { Spinner } from '../../ui/Spinner';

/** Set at build time (webpack DefinePlugin): "/" in production. Empty → keep the in-app sign-in form. */
const LANDING_URL = process.env.REACT_APP_LANDING_URL || '';

/**
 * Signed-out visitors sign in on the public landing (Next.js, same domain). Google sign-in from
 * there still returns to /auth/google/callback here, so the token flow is unchanged.
 *
 * The landing sends anyone with an access_token straight back to the app. Reaching /login means
 * this app decided the session is not usable, so the tokens are cleared first; otherwise a stale
 * token would bounce the visitor between the two forever.
 */
const LoginPage = () => {
    const [searchParams] = useSearchParams();
    const dispatch = useDispatch();

    useEffect(() => {
        if (!LANDING_URL) return;
        removeLocalStorageItem('access_token');
        removeLocalStorageItem('refresh_token');
        dispatch({ type: LOGOUT });
        const failed = searchParams.get('error') ? '?signin=failed' : '';
        window.location.replace(`${LANDING_URL}${failed}`);
    }, [dispatch, searchParams]);

    if (LANDING_URL) {
        return (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }

    return <LoginForm />;
};

export default LoginPage;
