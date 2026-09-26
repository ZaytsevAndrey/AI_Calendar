import { Suspense, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, Route, Routes } from 'react-router-dom';

import ProtectedRoute from 'modules/common/hocs/ProtectedRoute';
import PublicRoute from 'modules/common/hocs/PublicRoute';
import type { RootState } from 'store';
import { routeChunks, type RouteChunk } from './routeChunks';

function PageLoading() {
    return (
        <div className="page-shell-fill">
            <div className="flex flex-1 items-center justify-center text-sm text-ide-muted">
                Loading…
            </div>
        </div>
    );
}

function LazyRoute({
    chunk,
    access,
}: {
    chunk: RouteChunk;
    access: 'protected' | 'public' | 'open';
}) {
    const accessToken = useSelector((state: RootState) => state.auth?.accessToken);

    // Start the chunk while the settings gate is still resolving.
    useEffect(() => {
        if (access === 'protected' && !accessToken) {
            return;
        }
        void chunk.load();
    }, [access, accessToken, chunk]);

    const page = (
        <Suspense fallback={<PageLoading />}>
            <chunk.Component />
        </Suspense>
    );

    if (access === 'protected') {
        return <ProtectedRoute>{page}</ProtectedRoute>;
    }

    if (access === 'public') {
        return <PublicRoute>{page}</PublicRoute>;
    }

    return page;
}

const AppRoutes = () => {
    return (
        <div className="flex min-h-full flex-col max-md:h-full max-md:min-h-0 max-md:overflow-hidden lg:h-full lg:min-h-0 lg:overflow-hidden">
            <Routes>
                <Route path="/" element={<LazyRoute chunk={routeChunks.calendar} access="protected" />} />
                <Route path="/tasks" element={<LazyRoute chunk={routeChunks.tasks} access="protected" />} />
                <Route path="/events" element={<Navigate to="/tasks" replace />} />
                <Route path="/schedule" element={<Navigate to="/" replace />} />
                <Route path="/calendar" element={<Navigate to="/" replace />} />
                <Route path="/phases" element={<LazyRoute chunk={routeChunks.phases} access="protected" />} />
                <Route path="/habits" element={<LazyRoute chunk={routeChunks.habits} access="protected" />} />
                <Route path="/settings" element={<LazyRoute chunk={routeChunks.settings} access="protected" />} />
                <Route
                    path="/setup/phases"
                    element={<LazyRoute chunk={routeChunks.phaseSetup} access="protected" />}
                />
                <Route
                    path="/auth/google/callback"
                    element={<LazyRoute chunk={routeChunks.googleCallback} access="open" />}
                />
                <Route path="/login" element={<LazyRoute chunk={routeChunks.login} access="public" />} />
                <Route path="/register" element={<Navigate to="/login" replace />} />
                <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
                <Route path="/reset-password" element={<Navigate to="/login" replace />} />
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </div>
    );
};

export default AppRoutes;
