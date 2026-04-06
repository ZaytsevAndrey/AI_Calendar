import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { UserSettingsApi } from '../../../api/user-settings.api';
import { setSettingsChecked } from '../slice/userSettingsSlice';

export const useSettingsCheck = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const settingsChecked = useSelector((state: any) => state.userSettings.settingsChecked);

  useEffect(() => {
    const checkSettings = async () => {
      if (!settingsChecked) {
        const result = await UserSettingsApi.checkRequiredSettings();
        dispatch(setSettingsChecked(true));
        if (!result.requiredFilled && location.pathname !== '/settings') {
          navigate('/settings');
        }
      }
    };

    checkSettings();
  }, [settingsChecked, location.pathname, dispatch, navigate]);

  return { settingsChecked };
}; 