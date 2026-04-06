import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { UserSettingsApi } from '../../../api/user-settings.api';
import requestsStatuses from 'modules/common/constants/requestsStatuses';

type ProtectedRouteProps = {
    children: React.ReactElement;
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasRequiredSettings, setHasRequiredSettings] = useState(false);
    const [hasCheckedSettings, setHasCheckedSettings] = useState(false);
    const location = useLocation();
    
    // Використовуємо Redux стан замість useAuth
    const authState = useSelector((state: RootState) => state.auth);
    const isAuthenticated = !!authState?.accessToken;
    const loginStatus = authState?.loginStatus;

    useEffect(() => {
        console.log('ProtectedRoute useEffect:', { isAuthenticated, loginStatus });
        const checkRequiredSettings = async () => {
            try {
                console.log('ProtectedRoute: Checking required settings...');
                const response = await UserSettingsApi.checkRequiredSettings();
                setHasRequiredSettings(response.requiredFilled);
                console.log('ProtectedRoute: Required settings result:', response.requiredFilled);
            } catch (error) {
                console.error('ProtectedRoute: Error checking required settings:', error);
                setHasRequiredSettings(false);
            } finally {
                setIsLoading(false);
                setHasCheckedSettings(true);
            }
        };

        // Перевіряємо налаштування тільки якщо користувач автентифікований
        // і не тільки що залогінився (loginStatus !== success)
        if (isAuthenticated && loginStatus !== requestsStatuses.success) {
            console.log('ProtectedRoute: User authenticated, not just logged in, checking settings');
            checkRequiredSettings();
        } else if (isAuthenticated && loginStatus === requestsStatuses.success) {
            // Якщо користувач тільки що залогінився, не перевіряємо налаштування
            // LoginFormContainer сам зробить перевірку і редірект
            console.log('ProtectedRoute: User just logged in, skipping settings check');
            setIsLoading(false);
            setHasCheckedSettings(true);
        } else {
            console.log('ProtectedRoute: User not authenticated');
            setIsLoading(false);
        }
    }, [isAuthenticated, loginStatus]);

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    // Перевіряємо налаштування тільки якщо вже перевірили і користувач не тільки що залогінився
    if (hasCheckedSettings && !hasRequiredSettings && location.pathname !== '/settings' && loginStatus !== requestsStatuses.success) {
        return <Navigate to="/settings" replace />;
    }

    return children;
};

export default ProtectedRoute;
