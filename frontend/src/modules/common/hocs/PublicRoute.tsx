import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from 'modules/auth/hooks/useAuth';

type PublicRouteProps = {
    children: React.ReactElement;
};

const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
    const { isAuthenticated } = useAuth();

    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    return children;
};

export default PublicRoute;
