import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { useSettingsCheck } from '../../user-settings/hooks/useSettingsCheck';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const location = useLocation();
  const isAuthenticated = useSelector((state: RootState) => state.auth?.isAuthenticated ?? false);
  const { settingsChecked } = useSettingsCheck();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If settings gate is unchecked, still render children;
  // useSettingsCheck will fetch and redirect when needed
  return <>{children}</>;
};

export default ProtectedRoute; 