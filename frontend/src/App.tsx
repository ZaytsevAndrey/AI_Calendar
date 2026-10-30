import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './modules/auth/hooks/useAuth';
import { showsAppShell } from './pages/PhaseSetupPage/phaseSetupStep';
import Header from './modules/common/components/Header';
import BottomNav from './modules/common/components/BottomNav';
import AppRoutes from './AppRoutes';
import { PwaInstallBanner } from './modules/pwa/PwaInstallBanner';
import { ConflictChoiceHost } from './modules/schedule/components/ConflictChoiceHost';
import { useSyncClientTimeZone } from './modules/user-settings/hooks/useSyncClientTimeZone';
import { useSyncAppLanguage } from './modules/user-settings/hooks/useSyncAppLanguage';

const App: React.FC = () => {
    const { isAuthenticated } = useAuth();
    const location = useLocation();
    const shell = showsAppShell(location.pathname);
    useSyncClientTimeZone(isAuthenticated);
    useSyncAppLanguage(isAuthenticated);

    return (
        <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-ide-bg">
            {isAuthenticated && shell ? <Header /> : null}
            <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain bg-ide-bg max-md:overflow-hidden lg:overflow-hidden">
                <AppRoutes />
            </main>
            {isAuthenticated && shell ? <PwaInstallBanner /> : null}
            {isAuthenticated && shell ? <BottomNav /> : null}
            {isAuthenticated && shell ? <ConflictChoiceHost /> : null}
        </div>
    );
};

export default App;
