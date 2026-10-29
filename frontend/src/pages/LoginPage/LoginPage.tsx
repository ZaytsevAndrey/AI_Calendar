import React, { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import LoginForm from 'modules/auth/components/LoginForm';
import { LOGOUT } from 'modules/auth/actions/actionTypes';
import { Spinner } from '../../ui/Spinner';

/** Set at build time (webpack DefinePlugin): "/" in production. Empty → keep the in-app sign-in form. */
const LANDING_URL = process.env.REACT_APP_LANDING_URL || '';

/**
 * Signed-out visitors sign in on the public landing (Next.js, same domain). Provider sign-in from
 * there still returns to /auth/{provider}/callback here, so the token flow is unchanged.
 *
 * The landing sends anyone with an access_token straight back to the app. Reaching /login means
 * this app decided the session is not usable, so the tokens are cleared first; otherwise a stale
 * token would bounce the visitor between the two forever.
 */
const LoginPage = () => {
    const dispatch = useDispatch();
    // Read once: clearing tokens makes useAuth re-navigate to a bare /login and drop the query.
    const failed = useRef(new URLSearchParams(window.location.search).has('error'));
    const handedOver = useRef(false);

    useEffect(() => {
        if (!LANDING_URL || handedOver.current) return;
        handedOver.current = true;
        // Plain removeItem on purpose: removeLocalStorageItem fires an event that useAuth turns
        // into another /login navigation, which would race this redirect.
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        dispatch({ type: LOGOUT });
        window.location.replace(`${LANDING_URL}${failed.current ? '?signin=failed' : ''}`);
    }, [dispatch]);

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
