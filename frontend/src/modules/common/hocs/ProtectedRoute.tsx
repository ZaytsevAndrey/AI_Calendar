import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { useCheckRequiredSettingsQuery } from 'api/userSettingsApi';

type ProtectedRouteProps = {
    children: React.ReactElement;
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const location = useLocation();
    const authState = useSelector((state: RootState) => state.auth);
    const isAuthenticated = !!authState?.accessToken;

    const { data, isLoading, isError, refetch } = useCheckRequiredSettingsQuery(undefined, {
        skip: !isAuthenticated,
    });

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    if (isLoading) {
        return (
            <div className="page-shell-fill">
                <div className="flex flex-1 items-center justify-center text-sm text-ide-muted">
                    Loading…
                </div>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="page-shell-fill">
                <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
                    <p className="text-sm text-ide-muted">
                        Could not reach the API. The production instance may still be waking up.
                    </p>
                    <button type="button" className="ui-btn-primary" onClick={() => void refetch()}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const requiredFilled = data ? data.requiredFilled : false;
    const hasPhases = data ? data.hasPhases : true;

    if (!requiredFilled && location.pathname !== '/settings') {
        return <Navigate to="/settings" replace />;
    }

    if (
        requiredFilled &&
        !hasPhases &&
        location.pathname !== '/setup/phases'
    ) {
        return <Navigate to="/setup/phases" replace />;
    }

    return children;
};

export default ProtectedRoute;
