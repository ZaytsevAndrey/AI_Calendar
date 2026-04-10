import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import HomePage from 'pages/HomePage';
import LoginPage from 'pages/LoginPage';
import RegisterPage from 'pages/RegisterPage';
import ForgotPasswordPage from 'pages/ForgotPasswordPage';
import ResetPasswordPage from 'pages/ResetPasswordPage';
import TasksPage from 'pages/TasksPage';
import PhasesPage from 'pages/PhasesPage/PhasesPage';
import SettingsPage from 'pages/SettingsPage';
import SchedulePage from 'pages/SchedulePage';
import CalendarPage from 'pages/CalendarPage';
import EventsPage from 'pages/EventsPage';
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
                element={
                    <ProtectedRoute>
                        <TasksPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/schedule"
                element={
                    <ProtectedRoute>
                        <SchedulePage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/calendar"
                element={
                    <ProtectedRoute>
                        <CalendarPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/events"
                element={
                    <ProtectedRoute>
                        <EventsPage />
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
            <Route
                path="/auth/google/callback"
                element={
                    <ProtectedRoute>
                        <GoogleCallbackPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/login"
                element={
                    <PublicRoute>
                        <LoginPage />
                    </PublicRoute>
                }
            />
            <Route
                path="/register"
                element={
                    <PublicRoute>
                        <RegisterPage />
                    </PublicRoute>
                }
            />
            <Route
                path="/forgot-password"
                element={
                    <PublicRoute>
                        <ForgotPasswordPage />
                    </PublicRoute>
                }
            />
            <Route
                path="/reset-password"
                element={
                    <PublicRoute>
                        <ResetPasswordPage />
                    </PublicRoute>
                }
            />
            <Route path="*" element={ <Navigate to="/" /> } />
        </Routes>
    );
};

export default AppRoutes;
