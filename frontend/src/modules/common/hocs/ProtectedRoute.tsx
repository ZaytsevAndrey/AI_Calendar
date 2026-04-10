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

    const { data, isLoading, isError } = useCheckRequiredSettingsQuery(undefined, {
        skip: !isAuthenticated,
    });

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    if (isLoading) {
        return <div>Loading...</div>;
    }

    const requiredFilled = !isError && data ? data.requiredFilled : false;
    const hasPhases = !isError && data ? data.hasPhases : true;

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
