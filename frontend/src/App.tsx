import React from 'react';
import { useAuth } from './modules/auth/hooks/useAuth';
import Header from './modules/common/components/Header';
import AppRoutes from './AppRoutes';

const App: React.FC = () => {
    const { isAuthenticated } = useAuth();

    return (
        <div className="flex h-[100dvh] flex-col overflow-hidden bg-ide-bg">
            {isAuthenticated && <Header />}
            <main
                className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-ide-bg ${isAuthenticated ? 'pt-[5.75rem] sm:pt-16' : ''}`}
            >
                <AppRoutes />
            </main>
        </div>
    );
};

export default App;
