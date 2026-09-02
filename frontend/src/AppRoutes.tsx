import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import HomePage from 'pages/HomePage';
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
        <Routes>
            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <HomePage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/tasks"
                element={<Navigate to="/events" replace />}
            />
            <Route
                path="/events"
                element={
                    <ProtectedRoute>
                        <EventsPage />
                    </ProtectedRoute>
                }
            />
            <Route path="/schedule" element={<Navigate to="/calendar" replace />} />
            <Route
                path="/calendar"
                element={
                    <ProtectedRoute>
                        <CalendarPage />
                    </ProtectedRoute>
                }
            />
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
    );
};

export default AppRoutes;
