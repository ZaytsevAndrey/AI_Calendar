import React from 'react';
import { useAuth } from './modules/auth/hooks/useAuth';
import Header from './modules/common/components/Header';
import BottomNav from './modules/common/components/BottomNav';
import BuildFooter from './modules/common/components/BuildFooter';
import AppRoutes from './AppRoutes';
import { PwaInstallBanner } from './modules/pwa/PwaInstallBanner';
import { useSyncClientTimeZone } from './modules/user-settings/hooks/useSyncClientTimeZone';
import { useSyncAppLanguage } from './modules/user-settings/hooks/useSyncAppLanguage';

const App: React.FC = () => {
    const { isAuthenticated } = useAuth();
    useSyncClientTimeZone(isAuthenticated);
    useSyncAppLanguage(isAuthenticated);

    return (
        <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-ide-bg">
            {isAuthenticated && <Header />}
            <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain bg-ide-bg max-md:overflow-hidden lg:overflow-hidden">
                <AppRoutes />
            </main>
            {isAuthenticated ? <PwaInstallBanner /> : null}
            {isAuthenticated ? <BottomNav /> : null}
            <BuildFooter />
        </div>
    );
};

export default App;
