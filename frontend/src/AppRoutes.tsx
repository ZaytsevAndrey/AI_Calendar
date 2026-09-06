import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import LoginPage from 'pages/LoginPage';
import EventsPage from 'pages/EventsPage';
import PhasesPage from 'pages/PhasesPage/PhasesPage';
import SettingsPage from 'pages/SettingsPage';
import CalendarPage from 'pages/CalendarPage';
import GoogleCallbackPage from 'modules/auth/pages/GoogleCallbackPage';
import PhaseSetupPage from 'pages/PhaseSetupPage/PhaseSetupPage';

import PublicRoute from 'modules/common/hocs/PublicRoute';
import ProtectedRoute from 'modules/common/hocs/ProtectedRoute';

const AppRoutes = () => {
    return (
        <div className="flex h-full min-h-0 flex-col">
        <Routes>
            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <CalendarPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/tasks"
                element={
                    <ProtectedRoute>
                        <EventsPage />
                    </ProtectedRoute>
                }
            />
            <Route path="/events" element={<Navigate to="/tasks" replace />} />
            <Route path="/schedule" element={<Navigate to="/" replace />} />
            <Route path="/calendar" element={<Navigate to="/" replace />} />
            <Route
                path="/phases"
                element={
                    <ProtectedRoute>
                        <PhasesPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/settings"
                element={
                    <ProtectedRoute>
                        <SettingsPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/setup/phases"
                element={
                    <ProtectedRoute>
                        <PhaseSetupPage />
                    </ProtectedRoute>
                }
            />
            <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
            <Route
                path="/login"
                element={
                    <PublicRoute>
                        <LoginPage />
                    </PublicRoute>
                }
            />
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
            <Route path="/reset-password" element={<Navigate to="/login" replace />} />
            <Route path="*" element={ <Navigate to="/" /> } />
        </Routes>
        </div>
    );
};

export default AppRoutes;
