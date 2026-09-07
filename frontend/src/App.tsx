import React from 'react';
import { useAuth } from './modules/auth/hooks/useAuth';
import Header from './modules/common/components/Header';
import BuildFooter from './modules/common/components/BuildFooter';
import AppRoutes from './AppRoutes';
import { PwaInstallBanner } from './modules/pwa/PwaInstallBanner';
import { useSyncClientTimeZone } from './modules/user-settings/hooks/useSyncClientTimeZone';

const App: React.FC = () => {
    const { isAuthenticated } = useAuth();
    useSyncClientTimeZone(isAuthenticated);

    return (
        <div className="flex h-[100dvh] flex-col overflow-hidden bg-ide-bg">
            {isAuthenticated && <Header />}
            <main
                className={`min-h-0 flex-1 overflow-x-hidden bg-ide-bg ${
                    isAuthenticated ? 'overflow-hidden pt-[5.75rem] sm:pt-16' : 'overflow-y-auto'
                }`}
            >
                <AppRoutes />
            </main>
            {isAuthenticated ? <PwaInstallBanner /> : null}
            <BuildFooter />
        </div>
    );
};

export default App;
