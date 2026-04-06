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

  // Якщо налаштування не перевірені, дозволяємо рендерити children
  // useSettingsCheck сам зробить запит і редірект якщо потрібно
  return <>{children}</>;
};

export default ProtectedRoute; 