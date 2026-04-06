import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const useAuth = () => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const navigate = useNavigate();

    const checkAuth = () => {
        const token = localStorage.getItem('access_token');
        setIsAuthenticated(!!token);
    };

    useEffect(() => {
        // Initial check
        checkAuth();

        // Listen for storage changes
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'access_token') {
                checkAuth();
                if (!e.newValue) {
                    navigate('/login');
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);

        // Custom event for same-tab changes
        const handleCustomStorageChange = (e: CustomEvent) => {
            if (e.detail.key === 'access_token') {
                checkAuth();
                if (!e.detail.newValue) {
                    navigate('/login');
                }
            }
        };

        window.addEventListener('localStorageChange', handleCustomStorageChange as EventListener);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('localStorageChange', handleCustomStorageChange as EventListener);
        };
    }, [navigate]);

    return { isAuthenticated };
}; 